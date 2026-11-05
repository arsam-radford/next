/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * The AppAPI for SAGE3
 *
 * Flow Diagram
 * ┌──┐  ┌─────┐  ┌─────────┐  ┌───┐
 * │DB│◄─┤Model│◄─┤ Service │◄─┤API│
 * └──┘  └─────┘  └─────────┘  └───┘
 *
 * @author <a href="mailto:rtheriot@hawaii.edu">Ryan Theriot</a>
 * @version 1.0.0
 */

// External Imports
import { WebSocket } from 'ws';

// Collection Imports
import { AppsCollection, BoardsCollection, RoomsCollection } from '../../collections';

// Lib Imports
import { SubscriptionCache, readable } from '@sage3/backend';
import { APIClientWSMessage } from '@sage3/shared/types';
import { SBAuthSchema } from '@sage3/sagebase';
import { PresenceThrottle } from './presencethrottle';

export async function subscriptionWSRouter(
  socket: WebSocket,
  message: APIClientWSMessage,
  user: SBAuthSchema,
  cache: SubscriptionCache
): Promise<void> {
  // Only documents the user may read reach the client.
  const send = (event: unknown) => socket.send(JSON.stringify({ id: message.id, event }));
  switch (message.method) {
    case 'SUB': {
      // Subscribe to a room and all its children (Boards, apps)
      if (message.route.startsWith('/api/subscription/rooms/')) {
        const roomId = message.route.split('/').at(-1);
        if (!roomId) {
          socket.send(JSON.stringify({ id: message.id, success: false, message: 'No id provided' }));
          return;
        }
        const subs = [
          await RoomsCollection.subscribe(roomId, readable(RoomsCollection, user, send)),
          await BoardsCollection.subscribeByQuery('roomId', roomId, readable(BoardsCollection, user, send)),
          await AppsCollection.subscribeByQuery('roomId', roomId, readable(AppsCollection, user, send)),
        ].filter((sub) => sub !== undefined);
        cache.add(message.id, subs);
        break;
      }
      // Subscribe to a board and all its children (apps)
      else if (message.route.startsWith('/api/subscription/boards/')) {
        const boardId = message.route.split('/').at(-1);
        if (!boardId) {
          socket.send(JSON.stringify({ id: message.id, success: false, message: 'No id provided' }));
          return;
        }
        const subs = [
          await BoardsCollection.subscribe(boardId, readable(BoardsCollection, user, send)),
          await AppsCollection.subscribeByQuery('boardId', boardId, readable(AppsCollection, user, send)),
        ].filter((sub) => sub !== undefined);
        cache.add(message.id, subs);
      }
      // Subscribe to the presence collection
      // Presence collection is unique in that it is throttled
      else if (message.route === '/api/subscription/presence') {
        PresenceThrottle.addSubscription(message.id, socket, user);
      } else {
        console.log('Subscription> Not found', message.route);
      }
      break;
    }
    case 'UNSUB': {
      // Attempt to remove the subscription from presence. It might not be for presence but have to check to avoid memory leak
      PresenceThrottle.removeClient(message.id);
      // Unsubscribe Message
      cache.delete(message.id);
      break;
    }
    default: {
      socket.send(JSON.stringify({ id: message.id, success: false, message: 'Invalid method.' }));
    }
  }
}
