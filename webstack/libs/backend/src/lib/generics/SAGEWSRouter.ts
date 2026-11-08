/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { WebSocket } from 'ws';

import { SBAuthSchema, SBDocument, SBDocumentMessage, SBJSON } from '@sage3/sagebase';
import { APIClientWSMessage } from '@sage3/shared/types';

import { SubscriptionCache } from '../utils/subscription-cache';
import { AccessError, SAGE3Collection } from './SAGECollection';

import { URL } from 'node:url';

/**
 * A subscription callback that only passes on the documents the user may read.
 * A document the user can no longer read after an update reaches them as a deletion, by id only.
 * Events are checked one at a time, so they reach the client in order.
 */
export function readable<T extends SBJSON>(
  collection: SAGE3Collection<T>,
  user: SBAuthSchema,
  send: (message: SBDocumentMessage<T>) => void
): (message: SBDocumentMessage<T>) => void {
  let queue = Promise.resolve();
  return (message) => {
    queue = queue
      .then(async () => {
        const docs = await collection.readAs(user, message.doc);
        if (message.type === 'UPDATE') {
          const hidden = message.doc.filter((doc) => !docs.includes(doc)).map((doc) => ({ _id: doc._id }) as SBDocument<T>);
          if (hidden.length) send({ type: 'DELETE', col: message.col, doc: hidden });
          if (docs.length) send({ ...message, doc: docs, updates: message.updates.filter((u) => docs.some((doc) => doc._id === u.id)) });
        } else if (docs.length) {
          send({ ...message, doc: docs });
        }
      })
      .catch((error) => console.error('Subscription>', error));
  };
}

export async function sageWSRouter<T extends SBJSON>(
  collection: SAGE3Collection<T>,
  socket: WebSocket,
  message: APIClientWSMessage,
  user: SBAuthSchema,
  cache: SubscriptionCache
): Promise<void> {
  try {
    await route(collection, socket, message, user, cache);
  } catch (error) {
    const text = error instanceof AccessError ? error.message : 'Server error.';
    if (!(error instanceof AccessError)) console.error('WSRouter>', error);
    socket.send(JSON.stringify({ id: message.id, success: false, message: text }));
  }
}

async function route<T extends SBJSON>(
  collection: SAGE3Collection<T>,
  socket: WebSocket,
  message: APIClientWSMessage,
  user: SBAuthSchema,
  cache: SubscriptionCache
): Promise<void> {
  // path to the current collection
  const path = '/api/' + collection.name.toLowerCase();

  // Create a URL object to parse the route:
  // second argument required because the route is a relative URL but otherwise meaningless
  const socket_url = new URL(message.route, 'ws://localhost');
  const route = message.route;
  // get all the parameters and their values into an array, instead of a Map
  const params = Array.from(socket_url.searchParams);
  const reply = (data?: unknown) => socket.send(JSON.stringify({ id: message.id, success: true, data }));

  switch (message.method) {
    case 'POST': {
      if (message.body === undefined) throw new AccessError('No body provided', 400);
      // If 'batch' is present on the body this is a batch post
      if (message.body.batch) reply(await collection.createAs(user, message.body.batch as T[]));
      else reply((await collection.createAs(user, [message.body as T]))[0]);
      break;
    }
    case 'GET': {
      const body = message.body;
      let docs;
      // Batch GET: Get multiple docs.
      if (body && body.batch) docs = await collection.getBatch(body.batch as string[]);
      // GET: Get all the docs.
      else if (route === path) docs = await collection.getAll();
      // GET: Get one doc.
      else if (route.startsWith(path + '/')) {
        const doc = await collection.get(getIdFromRoute(route));
        const visible = doc ? await collection.readAs(user, [doc]) : [];
        if (visible.length === 0) throw new AccessError('Failed to get doc.', 404);
        reply(visible[0]);
        return;
      }
      if (!docs) throw new AccessError('Failed to get docs', 500);
      reply(await collection.readAs(user, docs));
      break;
    }
    case 'PUT': {
      if (message.body === undefined) throw new AccessError('No body provided', 400);
      // Batch PUT: Update multiple docs.
      if (message.body.batch) reply(await collection.updateAs(user, message.body.batch as any));
      else reply((await collection.updateAs(user, [{ id: getIdFromRoute(route), updates: message.body as any }]))[0]);
      break;
    }
    case 'DELETE': {
      const body = message.body;
      if (body && body.batch) reply(await collection.deleteAs(user, body.batch as string[]));
      else {
        await collection.deleteAs(user, [getIdFromRoute(route)]);
        reply();
      }
      break;
    }
    case 'SUB': {
      const forward = readable(collection, user, (event) => socket.send(JSON.stringify({ id: message.id, event })));
      let sub;
      // Subscribe to all docs
      if (route === path) sub = await collection.subscribeAll(forward);
      else if (params.length > 0) {
        if (params.length != 1) throw new AccessError('Improper query format', 400);
        sub = await collection.subscribeByQuery(params[0][0] as keyof T, params[0][1], forward);
      }
      // Subscribe to one doc
      else if (route.startsWith(path + '/')) sub = await collection.subscribe(getIdFromRoute(route), forward);
      if (sub) cache.add(message.id, [sub]);
      break;
    }
    case 'UNSUB': {
      // Unsubscribe Message
      cache.delete(message.id);
      break;
    }
    default:
      throw new AccessError('Invalid method', 400);
  }
}

/*
 * Get the id from the end of the route
 */
function getIdFromRoute(route: string): string {
  const id = route.split('/').at(-1);
  if (!id) throw new AccessError('No id provided', 400);
  return id;
}
