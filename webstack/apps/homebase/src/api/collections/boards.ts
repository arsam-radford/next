/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { AppName } from '@sage3/applications/schema';
import { BoardSchema, Position, Size } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, boardPermissionsOf, guarded, readRoom, roomPermissionsOf } from '@sage3/backend';
import { SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { BOARD_PERMISSIONS, checkOverridesChange, describeChange, has, Override, Permission as P } from '@sage3/shared';

import { deny, needInRoom } from './access';
import { AuditCollection } from './audit';

import { AnnotationsCollection } from './annotations';
import { AppsCollection } from './apps';
import { InsightCollection } from './insight';

// Minimal app info needed for board preview rendering
type AppPreviewInfo = { position: Position; size: Size; type: AppName; id: string };

// Server-side cache: boardId -> { apps, timestamp }
// Absorbs burst traffic when multiple users load the homepage simultaneously
const previewCache = new Map<string, { apps: AppPreviewInfo[]; timestamp: number }>();
const PREVIEW_CACHE_TTL = 30 * 1000; // 30 seconds

export type BoardDeleteInfo = {
  boardId: string;
  boardDeleted: boolean;
  appsDeleted: number;
  annotationsDeleted: boolean;
  insightsDeleted: number;
};

class SAGE3BoardsCollection extends SAGE3Collection<BoardSchema> {
  constructor() {
    super('BOARDS', {
      name: '',
      ownerId: '',
      roomId: '',
    });
    this.access = {
      create: async (auth, data) => {
        if (data.permissionPresets !== undefined) deny('Save permission presets after creating the board.');
        const room = await readRoom(data.roomId);
        if (!room) deny('Room not found.', 404);
        const permissions = await needInRoom(auth, data.roomId, P.ManageBoards);
        const error = checkOverridesChange([], data.overrides, room.data.roles, permissions & BOARD_PERMISSIONS);
        if (error) deny(error);
        return { ...data, ownerId: auth.id };
      },
      read: async (auth, doc) => has(await boardPermissionsOf(auth, doc._id, doc.data), P.ViewBoard),
      update: (auth, doc, update) => this.checkUpdate(auth, doc, update),
      delete: async (auth, doc) => {
        await needInRoom(auth, doc.data.roomId, P.ManageBoards);
      },
      written: (auth, before, after) => this.audit(auth, before, after),
    };
    const router = sageRouter<BoardSchema>(this);

    router.post(
      '/:id/overrides',
      guarded(async ({ params, body, user }, res) => {
        const doc = await this.saveOverrides(user as SBAuthSchema, String(params.id), body.overrides, body.before);
        res.status(200).send({ success: true, data: [doc] });
      })
    );

    router.post(
      '/:id/presets',
      guarded(async ({ params, body, user }, res) => {
        const doc = await this.changePreset(user as SBAuthSchema, String(params.id), 'save', body);
        res.status(200).send({ success: true, data: [doc] });
      })
    );
    for (const action of ['apply', 'delete'] as const) {
      router.post(
        `/:id/presets/:presetId/${action}`,
        guarded(async ({ params, body, user }, res) => {
          const doc = await this.changePreset(user as SBAuthSchema, String(params.id), action, body, String(params.presetId));
          res.status(200).send({ success: true, data: [doc] });
        })
      );
    }

    // Batch preview: returns app layout (position/size/type) for multiple boards in one request.
    // Used by the homepage to render spatial previews without subscribing to app data.
    router.post('/preview', async ({ body, user }, res) => {
      const requested = body.boardIds as string[];
      const force = body.force === true;
      if (!requested || !Array.isArray(requested) || requested.length === 0) {
        res.status(400).send({ success: false, message: 'No boardIds provided.' });
        return;
      }
      const visible = await Promise.all(requested.map(async (id) => has(await boardPermissionsOf(user as SBAuthSchema, id), P.ViewBoard)));
      const boardIds = requested.filter((_id, i) => visible[i]);

      const now = Date.now();
      const result: Record<string, AppPreviewInfo[]> = {};
      const uncached: string[] = [];

      // Serve from cache where available (skipped when force=true)
      for (const boardId of boardIds) {
        const cached = previewCache.get(boardId);
        if (!force && cached && now - cached.timestamp < PREVIEW_CACHE_TTL) {
          result[boardId] = cached.apps;
        } else {
          uncached.push(boardId);
        }
      }

      // Fetch uncached boards in parallel
      if (uncached.length > 0) {
        const fetched = await Promise.all(
          uncached.map(async (boardId) => {
            const docs = await AppsCollection.query('boardId', boardId);
            const apps = (docs || []).map<AppPreviewInfo>((app) => ({
              position: app.data.position,
              size: app.data.size,
              type: app.data.type,
              id: app._id,
            }));
            previewCache.set(boardId, { apps, timestamp: now });
            return { boardId, apps };
          })
        );
        fetched.forEach(({ boardId, apps }) => {
          result[boardId] = apps;
        });
      }

      res.status(200).send({ success: true, data: result });
    });

    this.httpRouter = router;
  }

  private async checkUpdate(auth: SBAuthSchema, doc: SBDocument<BoardSchema>, update: Partial<BoardSchema>) {
    const roomPermissions = await roomPermissionsOf(auth, doc.data.roomId);
    if (!has(roomPermissions, P.ManageBoards)) deny();
    for (const key of Object.keys(update)) {
      // Overrides change through POST /boards/:id/overrides, which knows what the edit started from.
      if (!['name', 'description', 'color', 'code'].includes(key)) deny(`${key} cannot be changed here.`);
    }
  }

  /**
   * Replace the overrides, if they are still `before`: the version the edit started from.
   */
  private async saveOverrides(auth: SBAuthSchema, id: string, overrides: Override[], before: Override[]) {
    const doc = await this.get(id);
    if (!doc) deny('Board not found.', 404);
    const room = await readRoom(doc.data.roomId);
    if (!room) deny('Room not found.', 404);
    const roomPermissions = await roomPermissionsOf(auth, doc.data.roomId);
    if (!has(roomPermissions, P.ManageBoards)) deny();
    // Room permissions as the bound: an override cannot take away the means to undo it.
    const error = checkOverridesChange(before, overrides, room.data.roles, roomPermissions & BOARD_PERMISSIONS);
    if (error) deny(error);
    const result = await this.updateIf(id, auth.id, { overrides }, { overrides: before });
    if (result.conflict) deny('The permissions were changed by someone else. Reload them and try again.', 409);
    if (!result.doc) deny('Failed to save the permissions.', 500);
    await this.audit(auth, { ...doc, data: { ...doc.data, overrides: before } }, result.doc);
    return result.doc;
  }

  private async changePreset(auth: SBAuthSchema, id: string, action: 'save' | 'delete' | 'apply', body: {
    name?: string;
    overrides?: Override[];
    before?: Override[];
    preset?: NonNullable<BoardSchema['permissionPresets']>[number];
  }, presetId?: string) {
    const doc = await this.get(id);
    if (!doc) deny('Board not found.', 404);
    const room = await readRoom(doc.data.roomId);
    if (!room) deny('Room not found.', 404);
    const permissions = await needInRoom(auth, doc.data.roomId, P.ManageBoards);
    const presets = doc.data.permissionPresets ?? [];
    const conditions: Partial<BoardSchema> = { permissionPresets: doc.data.permissionPresets };
    let changes: Partial<BoardSchema>;
    let preset: NonNullable<BoardSchema['permissionPresets']>[number];
    if (action === 'save') {
      if (typeof body?.name !== 'string' || !body.name.trim()) deny('Enter a preset name.', 400);
      const name = body.name.trim();
      if (presets.some((p) => p.name === name)) deny('A preset with that name already exists.', 409);
      // Saving the editor's snapshot never applies it to the board.
      if (!isDeepStrictEqual(body.before, doc.data.overrides)) deny('The permissions changed. Reload them and try again.', 409);
      const error = checkOverridesChange(doc.data.overrides, body.overrides as Override[], room.data.roles, permissions & BOARD_PERMISSIONS);
      if (error) deny(error);
      preset = { id: randomUUID(), name, overrides: body.overrides as Override[] };
      changes = { permissionPresets: [...presets, preset] };
      conditions.overrides = doc.data.overrides;
    } else {
      const saved = presets.find((p) => p.id === presetId);
      if (!saved || !isDeepStrictEqual(saved, body?.preset)) deny('The preset changed or was deleted. Reload it and try again.', 409);
      preset = saved;
      if (action === 'apply') {
        if (!isDeepStrictEqual(body.before, doc.data.overrides)) deny('The permissions changed. Reload them and try again.', 409);
        const error = checkOverridesChange(doc.data.overrides, preset.overrides, room.data.roles, permissions & BOARD_PERMISSIONS);
        if (error) deny(error);
        changes = { overrides: preset.overrides };
        conditions.overrides = doc.data.overrides;
      } else {
        changes = { permissionPresets: presets.filter((p) => p.id !== presetId) };
      }
    }
    const result = await this.updateIf(id, auth.id, changes, conditions);
    if (result.conflict) deny('The permissions or presets changed. Reload them and try again.', 409);
    if (!result.doc) deny(`Failed to ${action} the preset.`, 500);
    if (action === 'apply') await this.audit(auth, doc, result.doc);
    await AuditCollection.record(auth, room, `board.preset.${action}`, id, `${doc.data.name}: ${action} preset ${preset.name}`);
    return result.doc;
  }

  private async audit(auth: SBAuthSchema, before: SBDocument<BoardSchema> | undefined, after: SBDocument<BoardSchema> | undefined) {
    const board = (after ?? before)!;
    const room = await readRoom(board.data.roomId);
    if (!room) return;
    if (!before) await AuditCollection.record(auth, room, 'board.create', board._id, `created ${board.data.name}`);
    else if (!after) await AuditCollection.record(auth, room, 'board.delete', board._id, `deleted ${board.data.name}`);
    else {
      if (before.data.name !== after.data.name) {
        await AuditCollection.record(auth, room, 'board.update', board._id, `renamed ${before.data.name} to ${after.data.name}`);
      }
      const targets = [...before.data.overrides, ...after.data.overrides].filter(
        (o, i, all) => all.findIndex((other) => other.kind === o.kind && other.target === o.target) === i
      );
      for (const t of targets) {
        const a = before.data.overrides.find((o) => o.kind === t.kind && o.target === t.target);
        const b = after.data.overrides.find((o) => o.kind === t.kind && o.target === t.target);
        const summary = [describeChange(a?.allow ?? 0, b?.allow ?? 0, 'allowed', 'stopped allowing'), describeChange(a?.deny ?? 0, b?.deny ?? 0, 'denied', 'stopped denying')]
          .filter(Boolean)
          .join('; ');
        if (summary) await AuditCollection.record(auth, room, 'board.overrides', board._id, `${board.data.name}, ${t.kind} ${t.target}: ${summary}`);
      }
    }
  }

  // Delete all boards owned by a specific user
  public async deleteUsersBoards(userId: string): Promise<BoardDeleteInfo[]> {
    const userBoards = await this.query('ownerId', userId);
    const boardsIds = userBoards ? userBoards.map((board) => board._id) : [];
    const boardsDeleted = await Promise.all(boardsIds.map((boardId) => this.deleteBoard(boardId)));
    return boardsDeleted;
  }

  // Delete all boards in a specific room
  public async deleteBoardsInRoom(roomId: string): Promise<BoardDeleteInfo[]> {
    const roomBoards = await this.query('roomId', roomId);
    const boardsIds = roomBoards ? roomBoards.map((board) => board._id) : [];
    const boardsDeleteInfo = [];
    for (const boardId of boardsIds) {
      const boardDeleteInfo = await this.deleteBoard(boardId);
      boardsDeleteInfo.push(boardDeleteInfo);
    }
    return boardsDeleteInfo;
  }

  // Transfer ownership of all boards from one user to another
  public async transferUsersBoards(oldUserId: string, newOwnerId: string): Promise<boolean> {
    const userBoards = await this.query('ownerId', oldUserId);
    const boardsIds = userBoards ? userBoards.map((board) => board._id) : [];
    const res = await Promise.all(boardsIds.map((boardId) => this.update(boardId, newOwnerId, { ownerId: newOwnerId })));
    return res ? true : false;
  }

  /**
   * This will delete the board and all the associated apps, annotations, and insights
   * @param boardId The id of the board you want to delete
   * @returns The information about the deletion
   */
  public async deleteBoard(boardId: string): Promise<BoardDeleteInfo> {
    const results = {
      boardId,
      boardDeleted: false,
      appsDeleted: 0,
      annotationsDeleted: false,
      insightsDeleted: 0,
    } as BoardDeleteInfo;
    // Evict cached preview so stale app layout is not served after deletion
    previewCache.delete(boardId);

    const boardDeleted = await this.delete(boardId);
    results.boardDeleted = boardDeleted ? true : false;

    const appsDeleted = await AppsCollection.deleteAppsOnBoard(boardId);
    results.appsDeleted = appsDeleted;

    const annotationsDeleted = await AnnotationsCollection.deleteAnnotationsOnBoard(boardId);
    results.annotationsDeleted = annotationsDeleted;

    const insightsDeleted = await InsightCollection.deleteInsightsOnBoard(boardId);
    results.insightsDeleted = insightsDeleted;
    return results;
  }
}

export const BoardsCollection = new SAGE3BoardsCollection();
