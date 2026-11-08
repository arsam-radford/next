/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import express from 'express';

import { SBAuthSchema, SBJSON } from '@sage3/sagebase';

import { AccessError, SAGE3Collection } from './SAGECollection';

type Handler = (req: express.Request, res: express.Response) => Promise<void>;

// Answer refusals with their status; anything else is a server error.
export function guarded(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).send({ success: false, message: error.message, data: undefined });
      } else {
        console.error('Router>', error);
        res.status(500).send({ success: false, message: 'Server error.', data: undefined });
      }
    }
  };
}

export function sageRouter<T extends SBJSON>(collection: SAGE3Collection<T>): express.Router {
  const router = express.Router();

  // POST: Add new document or multiple docs with a batch request
  router.post(
    '/',
    guarded(async ({ body, user }, res) => {
      const items = (body?.batch ?? [body]) as T[];
      const docs = await collection.createAs(user as SBAuthSchema, items);
      res.status(200).send({ success: true, message: 'Successfully created the documents.', data: docs });
    })
  );

  // GET: Get all the docs, multiple docs by id, or query
  router.get(
    '/',
    guarded(async ({ query, body, user }, res) => {
      let docs;
      const keys = Object.keys(query);
      if (body?.batch) docs = await collection.getBatch(body.batch);
      else if (keys.length === 0) docs = await collection.getAll();
      else if (keys.length === 1) docs = await collection.query(keys[0], query[keys[0]] as string | number);
      else throw new AccessError('Too many query parameters. Only one query parameter allowed.', 400);
      if (!docs) throw new AccessError('Failed to retrieve documents.', 500);
      const data = await collection.readAs(user as SBAuthSchema, docs);
      res.status(200).send({ success: true, message: 'Successfully retrieved documents.', data });
    })
  );

  // GET: Get one doc.
  router.get(
    '/:id',
    guarded(async ({ params, user }, res) => {
      const doc = await collection.get(String(params.id));
      const data = doc ? await collection.readAs(user as SBAuthSchema, [doc]) : [];
      if (data.length === 0) throw new AccessError('Failed to retrieve the document.', 404);
      res.status(200).send({ success: true, message: 'Successfully retrieved the documents.', data });
    })
  );

  // PUT: Update multiple docs with a batch
  router.put(
    '',
    guarded(async ({ body, user }, res) => {
      if (!body?.batch) throw new AccessError('No batch property on body.', 400);
      const data = await collection.updateAs(user as SBAuthSchema, body.batch);
      res.status(200).send({ success: true, message: 'Successfully updated documents.', data });
    })
  );

  // PUT: Update one doc
  router.put(
    '/:id',
    guarded(async ({ params, body, user }, res) => {
      const data = await collection.updateAs(user as SBAuthSchema, [{ id: String(params.id), updates: body }]);
      res.status(200).send({ success: true, message: 'Successfully updated the document.', data });
    })
  );

  // DELETE: Delete multiple docs with batch
  router.delete(
    '',
    guarded(async ({ body, user }, res) => {
      if (!body?.batch) throw new AccessError('No batch property on body.', 400);
      const data = await collection.deleteAs(user as SBAuthSchema, body.batch);
      res.status(200).send({ success: true, message: 'Successfully deleted the documents.', data });
    })
  );

  // DELETE: Delete one doc
  router.delete(
    '/:id',
    guarded(async ({ params, user }, res) => {
      const data = await collection.deleteAs(user as SBAuthSchema, [String(params.id)]);
      res.status(200).send({ success: true, message: 'Successfully deleted the document.', data });
    })
  );

  return router;
}
