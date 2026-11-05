/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { Router } from 'express';
import { RoomSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, accountOf, guarded, roomPermissionsOf, readMember } from '@sage3/backend';
import { SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { checkRolesChange, describeChange, has, Permission as P, rank, Role, RolesSchema } from '@sage3/shared';

import { deny } from './access';
import { AuditCollection } from './audit';
import { BoardDeleteInfo, BoardsCollection } from './boards';
import { PluginsCollection } from './plugins';
import { RoomMembersCollection } from './roommembers';
import { AssetsCollection } from './assets';
import { RoomTemplatesCollection } from './roomtemplates';

export type RoomDeleteInfo = {
  roomId: string;
  roomDeleted: boolean;
  boardsDeleteInfo: BoardDeleteInfo[];
  assetsDeleted: number;
  pluginsDeleted: number;
  roomMembersDeleted: number;
};

class SAGE3RoomsCollection extends SAGE3Collection<RoomSchema> {
  constructor() {
    super('ROOMS', {
      name: '',
      ownerId: '',
    });

    this.access = {
      create: async (auth, data) => {
        if (!accountOf(auth).createRooms) deny('You cannot create rooms.');
        if (!RolesSchema.safeParse(data.roles).success) deny('Invalid roles.', 400);
        return { ...data, ownerId: auth.id, bans: [] };
      },
      read: async (auth, doc) => doc.data.isListed || (await isInRoom(auth, doc)),
      update: (auth, doc, update) => this.checkUpdate(auth, doc, update),
      delete: async (auth, doc) => {
        if (auth.id !== doc.data.ownerId && !accountOf(auth).instanceAdmin) deny('Only the owner can delete the room.');
      },
      written: async (auth, before, after) => {
        // The creator joins their new room.
        if (!before && after) await RoomMembersCollection.addMember(after._id, auth.id, []);
        if (before && after) await this.audit(auth, before, after);
      },
    };
    const router = Router();
    router.get('/templates', guarded(async ({ user }, res) => {
      res.status(200).send({ success: true, data: await RoomTemplatesCollection.list(user as SBAuthSchema) });
    }));
    router.post('/:id/templates', guarded(async ({ params, body, user }, res) => {
      res.status(200).send({ success: true, data: await RoomTemplatesCollection.save(user as SBAuthSchema, this, String(params.id), body) });
    }));
    router.post('/templates/:templateId/publication', guarded(async ({ params, body, user }, res) => {
      res.status(200).send({ success: true, data: await RoomTemplatesCollection.publication(user as SBAuthSchema, this, String(params.templateId), body) });
    }));
    router.delete('/templates/:templateId', guarded(async ({ params, user }, res) => {
      await RoomTemplatesCollection.remove(user as SBAuthSchema, this, String(params.templateId));
      res.status(200).send({ success: true });
    }));
    router.post('/from-template', guarded(async ({ body, user }, res) => {
      res.status(200).send({ success: true, data: await RoomTemplatesCollection.createRoom(user as SBAuthSchema, this, body) });
    }));
    router.post(
      '/:id/roles',
      guarded(async ({ params, body, user }, res) => {
        res.status(200).send({ success: true, data: [await this.saveRoles(user as SBAuthSchema, String(params.id), body.roles, body.before)] });
      })
    );
    router.use(sageRouter<RoomSchema>(this));
    this.httpRouter = router;
  }

  private async checkUpdate(auth: SBAuthSchema, doc: SBDocument<RoomSchema>, update: Partial<RoomSchema>) {
    const permissions = await roomPermissionsOf(auth, doc._id);
    for (const key of Object.keys(update)) {
      if (['name', 'description', 'color', 'isListed', 'isPrivate'].includes(key)) {
        if (!has(permissions, P.ManageRoom)) deny();
      } else if (key === 'ownerId') {
        if (auth.id !== doc.data.ownerId && !accountOf(auth).instanceAdmin) deny('Only the owner can transfer the room.');
      } else {
        // Roles change through POST /rooms/:id/roles, which knows what the edit started from.
        deny(`${key} cannot be changed here.`);
      }
    }
  }

  /**
   * Replace the roles, if they are still `before`: the version the edit started from. Otherwise
   * someone else changed them meanwhile and the edit is refused rather than overwriting theirs.
   */
  private async saveRoles(auth: SBAuthSchema, id: string, roles: Role[], before: Role[]) {
    const doc = await this.get(id);
    if (!doc) deny('Room not found.', 404);
    const permissions = await roomPermissionsOf(auth, id);
    if (!has(permissions, P.ManageRoles)) deny();
    const member = await readMember(id, auth.id);
    // Checking against `before` is sound: the write below only commits while the roles equal it.
    const error = checkRolesChange(before, roles, rank({ ...doc.data, roles: before }, member?.data, accountOf(auth)), permissions);
    if (error) deny(error);
    const result = await this.updateIf(id, auth.id, { roles }, { roles: before });
    if (result.conflict) deny('The roles were changed by someone else. Reload them and try again.', 409);
    if (!result.doc) deny('Failed to save the roles.', 500);
    await this.audit(auth, { ...doc, data: { ...doc.data, roles: before } }, result.doc);
    return result.doc;
  }

  private async audit(auth: SBAuthSchema, before: SBDocument<RoomSchema>, after: SBDocument<RoomSchema>) {
    const a = before.data;
    const b = after.data;
    for (const role of b.roles) {
      const old = a.roles.find((r) => r.id === role.id);
      if (!old) await AuditCollection.record(auth, after, 'role.create', role.id, `created ${role.name} (${describeChange(0, role.permissions)})`);
      else if (old.permissions !== role.permissions || old.name !== role.name || old.color !== role.color || old.group !== role.group) {
        const renamed = old.name !== role.name ? `renamed ${old.name} to ${role.name}` : role.name;
        await AuditCollection.record(auth, after, 'role.update', role.id, [renamed, describeChange(old.permissions, role.permissions)].filter(Boolean).join(': '));
      }
    }
    for (const role of a.roles) {
      if (!b.roles.some((r) => r.id === role.id)) await AuditCollection.record(auth, after, 'role.delete', role.id, `deleted ${role.name}`);
    }
    if (a.roles.map((r) => r.id).join() !== b.roles.map((r) => r.id).join() && a.roles.length === b.roles.length) {
      await AuditCollection.record(auth, after, 'role.reorder', after._id, b.roles.map((r) => r.name).join(' < '));
    }
    const settings = (['name', 'description', 'color', 'isListed', 'isPrivate'] as const).filter((key) => a[key] !== b[key]);
    if (settings.length) await AuditCollection.record(auth, after, 'room.update', after._id, `changed ${settings.join(', ')}`);
    if (a.ownerId !== b.ownerId) await AuditCollection.record(auth, after, 'room.transfer', b.ownerId, 'transferred ownership');
  }

  // Delete all the rooms of a specific user
  public async deleteUsersRooms(userId: string): Promise<RoomDeleteInfo[]> {
    // Delete the rooms of the user
    const userRooms = await this.query('ownerId', userId);
    const roomsIds = userRooms ? userRooms.map((room) => room._id) : [];
    // Promise all delete using deleteRoom
    const roomsDeleted = await Promise.all(roomsIds.map((roomId) => this.deleteRoom(roomId)));
    return roomsDeleted;
  }

  public async deleteRoom(roomId: string): Promise<RoomDeleteInfo> {
    const results = {
      roomId,
      roomDeleted: false,
      boardsDeleteInfo: [],
      assetsDeleted: 0,
      pluginsDeleted: 0,
      roomMembersDeleted: 0,
    } as RoomDeleteInfo;

    // Delete the room
    const roomDeleted = await this.delete(roomId);
    results.roomDeleted = roomDeleted ? true : false;
    // Delete the boards of the room
    const boardsDelInfo = await BoardsCollection.deleteBoardsInRoom(roomId);
    results.boardsDeleteInfo = boardsDelInfo;
    // Delete the assets of the room
    const assetsDeleted = await AssetsCollection.deleteAssetsInRoom(roomId);
    results.assetsDeleted = assetsDeleted ? assetsDeleted : 0;
    // Delete the plugins of the room
    const pluginsDeleted = await PluginsCollection.deletePluginsInRoom(roomId);
    results.pluginsDeleted = pluginsDeleted;
    // Delete the members of the room
    const membersDeleted = await RoomMembersCollection.deleteMembersInRoom(roomId);
    results.roomMembersDeleted = membersDeleted ? membersDeleted : 0;
    return results;
  }

  // Transfer a user's rooms to another user
  public async transferUsersRooms(oldOwnerId: string, newOwnerId: string): Promise<string[]> {
    const userRooms = await this.query('ownerId', oldOwnerId);
    const roomsIds = userRooms ? userRooms.map((room) => room._id) : [];
    const res = await Promise.all(roomsIds.map((roomId) => this.update(roomId, newOwnerId, { ownerId: newOwnerId })));
    const updatedRooms = res ? roomsIds : [];
    // Filter undefined values
    return updatedRooms.filter((r) => r);
  }
}

export const RoomsCollection = new SAGE3RoomsCollection();

async function isInRoom(auth: SBAuthSchema, room: SBDocument<RoomSchema>): Promise<boolean> {
  return auth.id === room.data.ownerId || accountOf(auth).instanceAdmin || !!(await readMember(room._id, auth.id));
}
