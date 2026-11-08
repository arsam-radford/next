/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { AppName, AppSchema } from '@sage3/applications/schema';
import { appActions } from '@sage3/applications/actions';
import { SAGE3Collection, sageRouter, appPermissionsOf, boardPermissionsOf, guarded, readBoard, readRoom, roomPermissionsOf } from '@sage3/backend';
import { SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { APP_PERMISSIONS, appPermission, checkOverridesChange, describeChange, has, Override, Permission as P } from '@sage3/shared';

import { deny } from './access';
import { AssetsCollection } from './assets';
import { AuditCollection } from './audit';

// App types that need a permission beyond Create Apps to create and use.
const required: Partial<Record<AppName, number>> = {
  SageCell: P.ExecuteCode,
  SageIdeator: P.UseAI,
  Screenshare: P.Screenshare,
  PluginApp: P.UsePlugins,
};

// Placing an app can need more than using it.
const placing: Partial<Record<AppName, number>> = { PluginApp: P.PlacePlugins };

// Moving fields cannot change while an app is pinned.
const moving = ['position', 'size', 'rotation', 'dragging'];

class SAGE3AppsCollection extends SAGE3Collection<AppSchema> {
  constructor() {
    super('APPS', {
      roomId: '',
      boardId: '',
      type: 'Stickie',
    });
    this.access = {
      create: (auth, data) => this.checkCreate(auth, data),
      read: async (auth, doc) => has(await boardPermissionsOf(auth, doc.data.boardId), P.ViewBoard),
      update: (auth, doc, update) => this.checkUpdate(auth, doc, update),
      delete: async (auth, doc) => {
        if (!has(await appPermissionsOf(auth, doc.data), appPermission('Delete', doc._createdBy === auth.id))) deny();
      },
      written: (auth, before, after) => this.audit(auth, before, after),
    };
    const router = sageRouter<AppSchema>(this);

    // Run an app action: an interaction such as voting, which needs Interact With Apps rather than Edit Apps.
    router.post(
      '/:id/action',
      guarded(async ({ params, body, user }, res) => {
        const auth = user as SBAuthSchema;
        for (let attempt = 0; attempt < 20; attempt++) {
          const app = await this.get(String(params.id));
          if (!app) deny('App not found.', 404);
          const action = (appActions[app.data.type] as Record<string, (s: unknown, a: Record<string, unknown>, u: string) => object> | undefined)?.[
            String(body?.name)
          ];
          if (!action) deny('Unknown action.', 404);
          // Editing an app includes interacting with it. Posting in a chat also needs Chat, so a read-only chat takes no posts.
          const permissions = await appPermissionsOf(auth, app.data);
          const interact = has(permissions, P.InteractWithApps) || has(permissions, appPermission('Edit', app._createdBy === auth.id));
          if (!interact || !has(permissions, (app.data.type === 'Chat' ? P.Chat : 0) | (required[app.data.type] ?? 0))) deny();

          let changes: object;
          try {
            changes = action(app.data.state, (body?.args ?? {}) as Record<string, unknown>, auth.id);
          } catch (error) {
            deny(error instanceof Error ? error.message : 'Action refused.', 400);
          }
          // Commit only if the fields the action read are unchanged; otherwise run it again on the new state.
          const state = app.data.state as Record<string, unknown>;
          const result = await this.collection.docRef(app._id).updateNestedMany(
            Object.entries(changes).map(([key, value]) => ({ segments: ['state', key], value })),
            auth.id,
            Object.keys(changes).map((key) => ({ segments: ['state', key], value: state[key] as never }))
          );
          if (result.success) {
            res.status(200).send({ success: true, data: [result.doc] });
            return;
          }
          if (!result.conflict) deny('Failed to apply the action.', 500);
        }
        deny('The app is too busy. Try again.', 409);
      })
    );

    // Replace an app's own overrides, if they are still `before`: the version the edit started from.
    router.post(
      '/:id/overrides',
      guarded(async ({ params, body, user }, res) => {
        const auth = user as SBAuthSchema;
        const app = await this.get(String(params.id));
        if (!app) deny('App not found.', 404);
        const room = await readRoom(app.data.roomId);
        if (!room) deny('Room not found.', 404);
        const permissions = await roomPermissionsOf(auth, app.data.roomId);
        if (!has(permissions, P.ManageBoards)) deny();
        const current = app.data.overrides ?? [];
        const before = body.before as Override[];
        const overrides = body.overrides as Override[];
        if (JSON.stringify(current) !== JSON.stringify(before)) deny('The permissions were changed by someone else. Reload them and try again.', 409);
        if (overrides.some((o) => o.kind !== 'role')) deny('App permissions are set per role.', 400);
        const error = checkOverridesChange(before, overrides, room.data.roles, permissions & APP_PERMISSIONS, APP_PERMISSIONS);
        if (error) deny(error);
        // Committed only while the stored overrides are still the ones checked above.
        const result = await this.updateIf(app._id, auth.id, { overrides }, { overrides: app.data.overrides });
        if (result.conflict) deny('The permissions were changed by someone else. Reload them and try again.', 409);
        if (!result.doc) deny('Failed to save the permissions.', 500);
        for (const o of [...before, ...overrides].filter((o, i, all) => all.findIndex((x) => x.kind === o.kind && x.target === o.target) === i)) {
          const a = before.find((x) => x.kind === o.kind && x.target === o.target);
          const b = overrides.find((x) => x.kind === o.kind && x.target === o.target);
          const summary = [describeChange(a?.allow ?? 0, b?.allow ?? 0, 'allowed', 'stopped allowing'), describeChange(a?.deny ?? 0, b?.deny ?? 0, 'denied', 'stopped denying')]
            .filter(Boolean)
            .join('; ');
          if (summary) await AuditCollection.record(auth, room, 'app.overrides', app._id, `${app.data.type} "${app.data.title}", ${o.kind} ${o.target}: ${summary}`);
        }
        res.status(200).send({ success: true, data: [result.doc] });
      })
    );

    this.httpRouter = router;
  }

  private async checkCreate(auth: SBAuthSchema, data: AppSchema): Promise<AppSchema> {
    const board = await readBoard(data.boardId);
    if (!board || board.data.roomId !== data.roomId) deny('Board not found in this room.', 404);
    const permissions = await boardPermissionsOf(auth, data.boardId);
    if (!has(permissions, P.CreateApps | (required[data.type] ?? 0) | (placing[data.type] ?? 0))) deny();

    // An app showing another board's file shares that file with the room.
    const assetId = (data.state as { assetid?: string }).assetid;
    if (assetId) {
      const asset = await AssetsCollection.get(assetId);
      if (asset && asset.data.room !== data.roomId) deny('That file belongs to another room.');
      if (asset && asset.data.board && asset.data.board !== data.boardId && asset.data.owner !== auth.id) {
        if (!has(await boardPermissionsOf(auth, asset.data.board), P.ManageOthersAssets)) deny("Only its owner or Manage Others' Files can share that file.");
      }
    }
    // A copy keeps its app overrides when its creator could have set them; otherwise it starts with the board's permissions.
    let overrides: Override[] | undefined;
    const copied = (data.overrides ?? []).filter((o) => o.kind === 'role');
    if (copied.length) {
      const room = await readRoom(data.roomId);
      const roomPermissions = await roomPermissionsOf(auth, data.roomId);
      const error = room && checkOverridesChange([], copied, room.data.roles, roomPermissions & APP_PERMISSIONS, APP_PERMISSIONS);
      if (room && has(roomPermissions, P.ManageBoards) && !error) overrides = copied;
    }
    return { ...data, overrides };
  }

  private async checkUpdate(auth: SBAuthSchema, doc: SBDocument<AppSchema>, update: Partial<AppSchema>) {
    const permissions = await appPermissionsOf(auth, doc.data);
    const own = doc._createdBy === auth.id;
    for (const path of Object.keys(update)) {
      const key = path.split('.')[0];
      let need: number;
      if (moving.includes(key)) {
        // A pin stops everyone, its owner included, until someone unpins the app.
        if (doc.data.pinned) deny('The app is pinned.');
        need = appPermission('Arrange', own);
      } else if (key === 'pinned') {
        need = appPermission('Arrange', own);
      } else if (key === 'title' || key === 'state' || key === 'sourceApps') {
        need = appPermission('Edit', own);
        // Someone muted cannot rewrite a chat either.
        if (key === 'state' && doc.data.type === 'Chat') need |= P.Chat;
      } else if (key === 'raised') {
        // Bringing an app to the front is part of looking at it.
        need = P.ViewBoard;
      } else {
        deny(`${key} cannot be changed here.`);
      }
      if (!has(permissions, need)) deny();
    }
  }

  private async audit(auth: SBAuthSchema, before: SBDocument<AppSchema> | undefined, after: SBDocument<AppSchema> | undefined) {
    const app = (after ?? before)!;
    // Placing a file on another board shares it with the room.
    const assetId = (app.data.state as { assetid?: string }).assetid;
    if (!before && assetId) {
      const asset = await AssetsCollection.get(assetId);
      if (asset && asset.data.board && asset.data.board !== app.data.boardId) await AssetsCollection.update(assetId, auth.id, { board: '' });
    }

    // Only moderation of other people's apps goes in the audit log.
    if (app._createdBy === auth.id) return;
    let action = '';
    if (!after) action = 'deleted';
    else if (before && before.data.pinned !== after.data.pinned) action = after.data.pinned ? 'pinned' : 'unpinned';
    if (!action) return;
    const room = await readRoom(app.data.roomId);
    if (room) await AuditCollection.record(auth, room, `app.${action}`, app._id, `${action} ${app.data.type} "${app.data.title}"`);
  }

  // Delete all the apps on a specific board
  public async deleteAppsOnBoard(boardId: string): Promise<number> {
    // Delete the apps on the board
    const boardApps = await this.query('boardId', boardId);
    const appsIds = boardApps ? boardApps.map((app) => app._id) : [];
    const appsDeleted = await this.deleteBatch(appsIds);
    return appsDeleted ? appsDeleted.length : 0;
  }

  // Delete all the apps of a specific user
  public async deleteUsersApps(userId: string): Promise<number> {
    // Delete the apps of the user
    const userApps = await this.query('_createdBy', userId);
    const appsIds = userApps ? userApps.map((app) => app._id) : [];
    const appsDeleted = await this.deleteBatch(appsIds);
    return appsDeleted ? appsDeleted.length : 0;
  }

  // Transfer all the apps of a user to another user
  public async transferUsersApps(oldUserId: string, newCreatedBy: string): Promise<boolean> {
    // Get all the apps of the user
    const userApps = await this.query('_createdBy', oldUserId);
    const appsIds = userApps ? userApps.map((app) => app._id) : [];
    // Update the createdBy field of the apps
    const appsUpdated = await Promise.all(appsIds.map((appId) => this.updateCreatedBy(appId, newCreatedBy)));
    return appsUpdated ? true : false;
  }
}

export const AppsCollection = new SAGE3AppsCollection();
