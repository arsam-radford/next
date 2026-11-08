/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import express from 'express';
import { Request, Response } from 'express';
import { createProxyServer } from 'http-proxy-3';

import { config } from '../../../config';
import { canOnBoard } from '@sage3/backend';
import { SBAuthSchema } from '@sage3/sagebase';
import { Permission } from '@sage3/shared';
import { KernelInfo } from '@sage3/shared/types';

/**
 * Reading kernels is open to signed-in users. Creating one, or running, restarting,
 * interrupting or deleting one, needs Execute Code on its board; a private kernel is its owner's only.
 */
async function allowed(req: Request): Promise<boolean> {
  const auth = req.user as SBAuthSchema;
  const [, route, id] = req.path.split('/');
  if (req.method === 'GET' || route === 'status') return true;
  if (req.method === 'POST' && route === 'kernels') return canOnBoard(auth, String(req.body?.board), Permission.ExecuteCode);
  const response = await fetch(`${config.kernels.url}/collection`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return false;
  const kernel = ((await response.json()) as KernelInfo[]).find((k) => k.kernel_id === id);
  if (!kernel || (kernel.is_private && kernel.owner !== auth.id)) return false;
  return canOnBoard(auth, kernel.board, Permission.ExecuteCode);
}

// Custom logger to control the logging of the proxy
const logger = {
  info: (...args: any[]) => {
    // console.log('[PROXY][INFO]', ...args);
    return; // Disable info logging for proxy
  },
  warn: (...args: any[]) => {
    console.warn('[Kernels Proxy][WARN]', ...args);
  },
  error: (...args: any[]) => {
    console.error('[Kernels Proxy][ERROR]', ...args);
  },
};

/**
 * Route forwarding the kernels calls to the sage kernels server
 */
export function KernelsRouter() {
  console.log('Kernels> router for sage kernels', config.kernels.url);

  // The router is mounted at /api/kernels, so Express strips that prefix and the
  // proxy forwards req.url (e.g. /execute) onto the target — same effect as the
  // previous pathRewrite of '^/api/kernels' -> ''.
  const router = express.Router();

  const proxy = createProxyServer({
    target: config.kernels.url,
    changeOrigin: true,
    selfHandleResponse: true, // handle the response manually
  });

  // request handler making sure the body is parsed before proxying
  proxy.on('proxyReq', (proxyReq: ClientRequest, req: IncomingMessage) => {
    restream(proxyReq, req as Request);
  });

  // selfHandleResponse: relay the upstream response ourselves
  proxy.on('proxyRes', (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
    // Only for SSE routes
    if ((req as Request).path.includes('stream')) {
      res.writeHead(200, {
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
      });
      // Relay each chunk as it arrives. Do NOT also buffer and re-write on end,
      // or the client receives the whole stream twice (duplicated SSE output).
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();
      });
    } else {
      // Handle other routes normally
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();
      });
    }
  });

  proxy.on('error', (err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
    logger.error(err);
    // Errors can come from HTTP proxying (ServerResponse) or a ws upgrade (Socket)
    if (res instanceof ServerResponse) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end('Bad Gateway');
    } else {
      res.destroy();
    }
  });

  // http-proxy-3's web() is callback/event-based; failures surface via the
  // 'error' handler above rather than a rejected promise.
  router.use(async (req: Request, res: Response) => {
    try {
      if (!(await allowed(req))) {
        res.status(403).send({ success: false, message: 'Running code needs Execute Code on this board.' });
        return;
      }
    } catch (error) {
      logger.error(error);
      res.status(502).send({ success: false, message: 'Kernels unavailable.' });
      return;
    }
    proxy.web(req, res);
  });

  return router;
}

/*
 * Restream parsed body before proxying
 *
 * @param {ClientRequest} proxyReq
 * @param {Request} req
 * */
function restream(proxyReq: ClientRequest, req: Request): void {
  if (req.method === 'POST' && req.body) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Type', 'application/json');
    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
  }

  if (req.method === 'GET' && req.path.includes('stream')) {
    proxyReq.setHeader('Connection', 'keep-alive');
    proxyReq.setHeader('Cache-Control', 'no-cache');
    proxyReq.setHeader('Content-Type', 'text/event-stream');
  }
}
