/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Moves data from before room roles to the new model. Safe to run on every start:
// documents already migrated are left alone.

import { EVERYONE, openRoomRoles, Permission } from '@sage3/shared';
import { inviteId } from '@sage3/shared/types';

import { AssetsCollection } from './assets';
import { BoardsCollection } from './boards';
import { InvitesCollection } from './invites';
import { RoomMembersCollection } from './roommembers';
import { RoomsCollection } from './rooms';

type Legacy = { privatePin?: string; isPrivate?: boolean };

export async function migratePermissions(): Promise<void> {
  let changed = 0;

  // Rooms become Open collaboration, so everyone keeps doing what they could. A PIN becomes an invite code.
  for (const room of (await RoomsCollection.getAll()) ?? []) {
    if (room.data.roles) continue;
    const pin = (room.data as Legacy).privatePin;
    if (room.data.isPrivate && pin && /^[A-Za-z0-9-]{1,64}$/.test(pin)) {
      const invite = { roomId: room._id, code: pin, roles: [], expiresAt: 0, maxUses: 0, uses: 0 };
      await InvitesCollection.add(invite, room.data.ownerId, inviteId(room._id, pin));
    }
    await RoomsCollection.updateIf(room._id, '-', { roles: openRoomRoles, bans: [], privatePin: undefined }, {});
    changed++;
  }

  // A private board stays visible to its owner only; nobody else's knowledge of the PIN is on record.
  for (const board of (await BoardsCollection.getAll()) ?? []) {
    if (board.data.overrides) continue;
    const legacy = board.data as Legacy;
    const overrides = legacy.isPrivate
      ? [
          { kind: 'role' as const, target: EVERYONE, allow: 0, deny: Permission.ViewBoard },
          { kind: 'member' as const, target: board.data.ownerId, allow: Permission.ViewBoard, deny: 0 },
        ]
      : [];
    await BoardsCollection.updateIf(board._id, '-', { overrides, isPrivate: undefined, privatePin: undefined }, {});
    changed++;
  }

  // One membership document per user per room, instead of one list per room.
  for (const doc of (await RoomMembersCollection.getAll()) ?? []) {
    const members = (doc.data as unknown as { members?: string[] }).members;
    if (!members) continue;
    for (const userId of members) await RoomMembersCollection.addMember(doc.data.roomId, userId, []);
    await RoomMembersCollection.delete(doc._id);
    changed++;
  }

  // Existing files stay shared with the whole room.
  for (const asset of (await AssetsCollection.getAll()) ?? []) {
    if (asset.data.board !== undefined) continue;
    await AssetsCollection.update(asset._id, '-', { board: '' });
    changed++;
  }

  if (changed) console.log(`Permissions> Migrated ${changed} document(s) to room roles`);
}
