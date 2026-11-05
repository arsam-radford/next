/**
 * Copyright (c) SAGE3 Development Team 2025. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Node Imports
import { IncomingMessage, createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import express from 'express';

// SAGE3 Imports
import { loadConfig } from './config';
import { SAGEBase, SAGEBaseConfig, SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { appPermissionsOf, boardPermissionsOf, initPermissions } from '@sage3/backend/permissions';
import { appPermission, has, Override, Permission } from '@sage3/shared';

import { ServerConfiguration } from '@sage3/shared/types';

// YJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const YUtils = require('y-websocket/bin/utils');

type Scope = { boardId: string; write: number; app?: SBDocument<{ boardId: string; overrides?: Override[] }> };

/**
 * The board a Yjs document belongs to, and what writing to it needs (any one of the `write` bits).
 * Documents are named `annotations-<boardId>`, `apps-<boardId>` (the text of all of a board's apps),
 * or an app id (Drawing), which follows that app's own permissions.
 */
async function documentScope(name: string): Promise<Scope | undefined> {
  if (name.startsWith('annotations-')) return { boardId: name.slice('annotations-'.length), write: Permission.Annotate };
  // shortcut: one text document holds every app's text on a board, so it cannot apply per-app permissions; split it per app to do so.
  if (name.startsWith('apps-')) return { boardId: name.slice('apps-'.length), write: Permission.EditOwnApps | Permission.EditOthersApps };
  const apps = await SAGEBase.Database.collection<{ boardId: string; overrides?: Override[] }>('APPS');
  const app = await apps.docRef(name).read();
  return app ? { boardId: app.data.boardId, write: 0, app } : undefined;
}

// y-websocket sync messages: [0, 0] asks for state, [0, 1] and [0, 2] carry updates.
function isWrite(message: Uint8Array): boolean {
  return message[0] === 0 && (message[1] === 1 || message[1] === 2);
}

/**
 * Pass a client's messages on only while it may see the document, and its updates only while it may write.
 * Messages are checked in order, so they reach Yjs in the order they were sent.
 */
function guard(socket: WebSocket, auth: SBAuthSchema, scope: Scope) {
  const on = socket.on.bind(socket);
  let queue = Promise.resolve();
  socket.on = ((event: string, listener: (...args: any[]) => void) => {
    if (event !== 'message') return on(event, listener);
    return on('message', (data: Buffer, isBinary: boolean) => {
      queue = queue.then(async () => {
        const permissions = await boardPermissionsOf(auth, scope.boardId);
        if (!has(permissions, Permission.ViewBoard)) {
          socket.close();
          return;
        }
        if (isWrite(new Uint8Array(data))) {
          const app = scope.app;
          const allowed = app
            ? has(await appPermissionsOf(auth, app.data), appPermission('Edit', app._createdBy === auth.id))
            : (permissions & scope.write) !== 0;
          if (!allowed) return;
        }
        listener(data, isBinary);
      });
    });
  }) as typeof socket.on;
}

/**
 * The SAGE3 YJS Main entry point
 */
async function startServer() {
  console.log('Server> Starting SAGE3 YJS Server');

  const app = express();

  // Load config
  const config: ServerConfiguration = await loadConfig();

  // Initialization of SAGEBase
  const sbConfig: SAGEBaseConfig = {
    projectName: 'SAGE3',
    redisUrl: config.redis.url || 'redis://localhost:6379',
    authConfig: {
      ...config.auth,
      production: config.production,
    },
  };
  await SAGEBase.init(sbConfig, app);
  await initPermissions({ admins: config.auth.admins ?? [], restrictRoomCreation: !!config.features.restrictRoomCreation, secret: config.auth.sessionSecret });

  // Health check route
  app.get('/', (req, res) => {
    // Optionally, you can add checks for Redis or other services here
    // Example: Check if Redis is accessible, or check some service health

    // Respond with status 200 if everything is okay
    res.status(200).json({ status: 'healthy' });
  });

  // Create HTTP server
  const server = createServer(app);

  // Port to serve app
  const PORT = config.port_yjs;

  // Start listening
  server.listen(PORT, () => {
    console.log(`SAGE3 YJS Server> Listening on port ${PORT}`);
  });

  // Create WebSocket Server for YJS
  const yjsSocketServer = new WebSocketServer({ noServer: true });

  // WebSocket API for YJS
  yjsSocketServer.on('connection', (socket: WebSocket, request: IncomingMessage, auth: SBAuthSchema, scope?: Scope) => {
    if (scope) guard(socket, auth, scope);
    YUtils.setupWSConnection(socket, request);
  });

  // Websocket API for WebRTC
  const rtcSocketServer = new WebSocketServer({ noServer: true });
  const clients: Map<string, WebSocket[]> = new Map();
  // Remove a socket from one room, dropping the room once it is empty.
  // Guards against indexOf returning -1, which would otherwise splice the last member.
  function leaveRoom(room: string, socket: WebSocket) {
    const sockets = clients.get(room);
    if (!sockets) return;
    const index = sockets.indexOf(socket);
    if (index >= 0) sockets.splice(index, 1);
    if (sockets.length === 0) clients.delete(room);
  }
  // Broadcast to all clients in the room
  function emitRTC(room: string, type: string, params: any) {
    const msg = JSON.stringify({ type, params });
    clients.get(room)?.forEach((ws) => ws.send(msg));
  }

  rtcSocketServer.on('connection', (socket: WebSocket, _request: IncomingMessage) => {
    // new message
    socket.on('message', (data) => {
      const datastr = data.toString();
      const msg = JSON.parse(datastr);
      switch (msg.type) {
        case 'join': {
          if (!clients.has(msg.params.room)) {
            clients.set(msg.params.room, []);
          }
          const members = clients.get(msg.params.room)!;
          if (!members.includes(socket)) members.push(socket);
          break;
        }
        case 'pixels':
          // broadcast to all clients in the room
          emitRTC(msg.params.room, 'data', msg.params);
          break;
        case 'leave':
          leaveRoom(msg.params.room, socket);
          break;
      }
    });
    // close handler
    socket.on('close', () => {
      clients.forEach((_sockets, room) => leaveRoom(room, socket));
    });
    // error handler
    socket.on('error', (msg) => {
      console.log('WebRTC> error', msg);
      clients.forEach((_sockets, room) => leaveRoom(room, socket));
    });
  });

  server.on('upgrade', (request, socket, head) => {
    // get url path
    const pathname = request.url;
    if (!pathname) return;

    // Get Pathname
    const wsPath = pathname.split('/')[1];

    // YJS Stuff
    if (wsPath == 'yjs') {
      SAGEBase.Auth.sessionParser(request, {}, () => {
        const session = (request as any).session;
        if (!session?.passport?.user) {
          console.log('Authorization> WebSocket upgrade failed: Unauthorized');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        // E
        const auth = session.passport.user as SBAuthSchema;
        const name = decodeURIComponent((pathname.split('?')[0] ?? '').slice('/yjs/'.length));
        const refuse = () => {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
        };
        // The party hub is shared by everyone signed in; every other document belongs to a board.
        const checked = name === 'partyHub' ? Promise.resolve(undefined) : documentScope(name);
        checked
          .then(async (scope) => {
            if (name !== 'partyHub' && (!scope || !has(await boardPermissionsOf(auth, scope.boardId), Permission.ViewBoard))) return refuse();
            yjsSocketServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
              yjsSocketServer.emit('connection', ws, request, auth, scope);
            });
          })
          .catch(refuse);
      });
    }

    // WebRTC socket - noauth for now
    if (wsPath === 'rtc') {
      rtcSocketServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        rtcSocketServer.emit('connection', ws, request);
      });
      return;
    }
  });

  // Handle termination
  async function exitHandler() {
    console.log('ExitHandler> Closing server...');
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  }

  // Clean shutdown on signals
  if (!config.production) {
    process.on('exit', exitHandler);
    process.on('SIGINT', exitHandler);
    process.on('SIGUSR1', exitHandler);
    process.on('SIGUSR2', exitHandler);
    process.on('SIGTERM', exitHandler);
    process.on('warning', (e) => console.warn('Warning>', e.stack));
  }
}

startServer();
