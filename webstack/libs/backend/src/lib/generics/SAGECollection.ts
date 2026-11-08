/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { Router } from 'express';
import { WebSocket } from 'ws';

import {
  SAGEBase,
  SBCollectionRef,
  SBDocumentMessage,
  SBDocument,
  SBJSON,
  SBDocumentUpdate,
  SBAuthSchema,
  SBConditionalWriteResult,
  SBPrimitive,
} from '@sage3/sagebase';
import { APIClientWSMessage } from '@sage3/shared/types';

import { SubscriptionCache } from '../utils';
import { sageWSRouter } from './SAGEWSRouter';

/**
 * A refused request. Thrown by access checks; the routers answer with its status and message.
 */
export class AccessError extends Error {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

/**
 * Who may do what to a collection's documents. Each check throws an AccessError to refuse.
 */
export interface CollectionAccess<T extends SBJSON> {
  // Returns the data to store, which the check may adjust (for example to force the owner).
  create(auth: SBAuthSchema, data: T): Promise<T>;
  read(auth: SBAuthSchema, doc: SBDocument<T>): Promise<boolean>;
  update(auth: SBAuthSchema, doc: SBDocument<T>, update: SBDocumentUpdate<T>): Promise<void>;
  delete(auth: SBAuthSchema, doc: SBDocument<T>): Promise<void>;
  // Called after a successful write, for example to record it in the audit log.
  written?(auth: SBAuthSchema, before: SBDocument<T> | undefined, after: SBDocument<T> | undefined): Promise<void>;
}

// Top-level fields to set, or to remove when undefined.
type Fields<T> = Partial<T> | Record<string, SBPrimitive | undefined>;

const refuse = async (): Promise<never> => {
  throw new AccessError('Not allowed.');
};

export const denyAll: CollectionAccess<any> = { create: refuse, read: async () => false, update: refuse, delete: refuse };

///////////////////////////////////////////////////////////////////////////////
// SAGE3 Collection collection
///////////////////////////////////////////////////////////////////////////////

export class SAGE3Collection<T extends SBJSON> {
  private _collection!: SBCollectionRef<T>;
  private _name: string;
  private _queryableAttributes: Partial<T>;
  // Whether single-document updates are broadcast to subscribers.  Defaults to
  // true; a collection whose live sync is handled elsewhere (e.g. ANNOTATIONS,
  // synced via Yjs) can opt out to avoid re-broadcasting the whole document on
  // every update.
  private _publishUpdates: boolean;

  private _httpRouter!: Router;

  // Collections that clients reach through the generic routers set their own rules.
  public access: CollectionAccess<T> = denyAll;

  constructor(name: string, queryableAttributes: Partial<T>, options?: { publishUpdates?: boolean }) {
    this._name = name;
    this._queryableAttributes = queryableAttributes;
    this._publishUpdates = options?.publishUpdates ?? true;
  }

  protected get collection(): SBCollectionRef<T> {
    return this._collection;
  }

  public get name(): string {
    return this._name;
  }

  /**
   * Initialize the collection
   * @param clear Clear the whole collection before initializing
   */
  public async initialize(clear?: boolean, ttl?: number): Promise<void> {
    this._collection = await SAGEBase.Database.collection<T>(this.name, this._queryableAttributes, ttl);
    // Clear the collection at initialization
    if (clear) {
      this.deleteAll();
    }
  }

  /**
   * Add a single item to the collection
   * @param item The item to add
   * @param by Who added the item
   * @param id Force an id for the item
   * @returns The added item if succesfull. Otherwise underfined
   */
  public async add(item: T, by: string, id?: string): Promise<SBDocument<T> | undefined> {
    try {
      const docRef = await this._collection.addDoc(item, by, id);
      if (docRef) {
        const doc = await docRef.read();
        return doc;
      } else {
        return undefined;
      }
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Add a batch of items to the collection
   * This will partially add if some are 'adds' are not successful
   * @param item Item to add
   * @param by The id of the user adding the item
   * @returns An array of the succcesully added items
   */
  public async addBatch(items: T[], by: string): Promise<SBDocument<T>[] | undefined> {
    try {
      // Add a batch of items to the collection
      // This will partially add if some are 'adds' are not successful
      const docs = await this.collection.addDocs(items, by);
      // Return docs
      return docs;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Get an item by id from the collection
   * @param id The id of the item to get
   * @returns The item if successful. Otherwise undefined
   */
  public async get(id: string): Promise<SBDocument<T> | undefined> {
    try {
      const doc = await this._collection.docRef(id).read();
      return doc;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Get mulitple docs by id from the collection
   * @param ids The ids of the items to get
   * @returns The items if successful. Otherwise undefined
   */
  public async getBatch(ids: string[]): Promise<SBDocument<T>[] | undefined> {
    try {
      const docs = await Promise.all(ids.map((id) => this._collection.docRef(id).read()));
      return docs.filter((doc) => doc !== undefined && doc !== null) as SBDocument<T>[];
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Get all documents from the collection
   * @returns All documents if successful. Otherwise undefined
   */
  public async getAll(): Promise<SBDocument<T>[] | undefined> {
    try {
      const docs = await this._collection.getAllDocs();
      return docs;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Query the collection for a specific value
   * @param field The property field to query
   * @param query The value to query
   * @returns The documents that match the query if successful. Otherwise undefined
   */
  public async query(field: keyof T | keyof SBDocument<T>, query: string | number): Promise<SBDocument<T>[] | undefined> {
    try {
      const docs = await this._collection.query(field, query);
      return docs;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Update a document in the collection
   * @param id The id of the document to update
   * @param by Who is updating the document
   * @param update The update to apply
   * @returns True if successful. Otherwise false
   */
  public async update(id: string, by: string, update: SBDocumentUpdate<T>): Promise<SBDocument<T> | undefined> {
    try {
      const response = await this._collection.docRef(id).update(update, by, this._publishUpdates);
      return response.doc;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Update top-level fields only if the given fields still hold the given values, atomically.
   */
  public async updateIf(id: string, by: string, changes: Fields<T>, conditions: Fields<T>): Promise<SBConditionalWriteResult<T>> {
    const entries = (o: Fields<T>) => Object.entries(o).map(([key, value]) => ({ segments: [key], value: value as SBPrimitive }));
    return this._collection.docRef(id).updateNestedMany(entries(changes), by, entries(conditions));
  }

  public async updateBatch(updates: { id: string; updates: SBDocumentUpdate<T> }[], by: string): Promise<SBDocument<T>[] | undefined> {
    try {
      const docs = await this._collection.updateDocs(updates, by);
      return docs;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  public async updateCreatedBy(id: string, newCreatedBy: string): Promise<SBDocument<T> | undefined> {
    try {
      const response = await this._collection.docRef(id).updateCreatedBy(newCreatedBy);
      return response.doc;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  public async delete(id: string): Promise<string | undefined> {
    try {
      const response = await this._collection.docRef(id).delete();
      if (response.success && response.doc) {
        return response.doc._id;
      } else {
        return undefined;
      }
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  public async deleteBatch(ids: string[]): Promise<string[] | undefined> {
    try {
      // Wait for all promises to resolve
      const responses = await this.collection.deleteDocs(ids);
      // Get all the ids of the deleted documents
      const deletedIds = responses
        .map((r) => {
          if (r.success && r.doc) {
            return r.doc._id;
          } else {
            return undefined;
          }
        })
        .filter((id) => id !== undefined) as string[];
      if (deletedIds.length > 0) {
        return deletedIds;
      } else {
        return undefined;
      }
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  public async deleteAll(): Promise<void> {
    const refs = await this._collection.getAllDocRefs();
    for (const ref of refs) {
      await ref.delete();
    }
  }

  public async subscribe(id: string, callback: (message: SBDocumentMessage<T>) => void): Promise<(() => Promise<void>) | undefined> {
    try {
      const app = this._collection.docRef(id);
      const unsubscribe = await app.subscribe(callback);
      return unsubscribe;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  public async subscribeAll(callback: (message: SBDocumentMessage<T>) => void): Promise<(() => Promise<void>) | undefined> {
    try {
      const unsubscribe = await this._collection.subscribe(callback);
      return unsubscribe;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  public async subscribeByQuery(
    field: keyof T,
    value: string,
    callback: (message: SBDocumentMessage<T>) => void,
  ): Promise<(() => Promise<void>) | undefined> {
    try {
      const unsubscribe = await this._collection.subscribeToQuery(field, value, callback);
      return unsubscribe;
    } catch (error) {
      this.printError(error);
      return undefined;
    }
  }

  /**
   * Checked operations, used by the generic REST and WebSocket routers.
   */
  public async createAs(auth: SBAuthSchema, items: T[]): Promise<SBDocument<T>[]> {
    const data: T[] = [];
    for (const item of items) data.push(await this.access.create(auth, item));
    const docs = data.length === 1 ? [await this.add(data[0], auth.id)] : await this.addBatch(data, auth.id);
    if (!docs || docs.some((doc) => !doc)) throw new AccessError('Failed to create.', 500);
    for (const doc of docs as SBDocument<T>[]) await this.access.written?.(auth, undefined, doc);
    return docs as SBDocument<T>[];
  }

  public async readAs(auth: SBAuthSchema, docs: SBDocument<T>[]): Promise<SBDocument<T>[]> {
    const visible = await Promise.all(docs.map((doc) => this.access.read(auth, doc)));
    return docs.filter((_doc, i) => visible[i]);
  }

  public async updateAs(auth: SBAuthSchema, updates: { id: string; updates: SBDocumentUpdate<T> }[]): Promise<SBDocument<T>[]> {
    const before: SBDocument<T>[] = [];
    for (const u of updates) {
      const doc = await this.get(u.id);
      if (!doc) throw new AccessError('Not found.', 404);
      before.push(doc);
      await this.access.update(auth, doc, u.updates);
    }

    const after = updates.length === 1 ? [await this.update(updates[0].id, auth.id, updates[0].updates)] : ((await this.updateBatch(updates, auth.id)) ?? []);
    if (after.length !== updates.length || after.some((doc) => !doc)) throw new AccessError('Failed to update.', 500);
    for (let i = 0; i < before.length; i++) await this.access.written?.(auth, before[i], after[i]);
    return after as SBDocument<T>[];
  }

  public async deleteAs(auth: SBAuthSchema, ids: string[]): Promise<string[]> {
    const docs: SBDocument<T>[] = [];
    for (const id of ids) {
      const doc = await this.get(id);
      if (!doc) throw new AccessError('Not found.', 404);
      await this.access.delete(auth, doc);
      docs.push(doc);
    }
    const deleted = ids.length === 1 ? [await this.delete(ids[0])] : await this.deleteBatch(ids);
    if (!deleted || deleted.some((id) => !id)) throw new AccessError('Failed to delete.', 500);
    for (const doc of docs) await this.access.written?.(auth, doc, undefined);
    return deleted as string[];
  }

  protected set httpRouter(router: Router) {
    this._httpRouter = router;
  }

  public router(): Router {
    return this._httpRouter;
  }

  public wsRouter(socket: WebSocket, message: APIClientWSMessage, user: SBAuthSchema, cache: SubscriptionCache): Promise<void> {
    return sageWSRouter<T>(this, socket, message, user, cache);
  }

  protected printMessage(message: string) {
    console.log(`SAGE3Collection ${this.name}> ${message}`);
  }

  protected printError(message: unknown) {
    console.error(`SAGE3Collection ${this.name}> ${message}`);
  }

  protected printWarn(message: string) {
    console.warn(`SAGE3Collection ${this.name}> ${message}`);
  }
}
