/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { inviteId, memberId, RoomMembersSchema, RoomSchema } from '@sage3/shared/types';
import { v5 as uuidv5 } from 'uuid';
import { config } from '../../config';
import { SAGE3Collection, sageRouter, accountOf, guarded, inRoom, readMember, readRoom, roomPermissionsOf } from '@sage3/backend';
import { SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { has, Permission as P, rank, rankOfMember } from '@sage3/shared';

import { deny, refuse } from './access';
import { AuditCollection } from './audit';
import { InvitesCollection } from './invites';
import { RoomsCollection } from './rooms';

// Memberships: one document per user per room. Changed only through the routes below.
class SAGE3RoomMembersCollection extends SAGE3Collection<RoomMembersSchema> {
  constructor() {
    super('ROOMMEMBERS', {
      roomId: '',
      userId: '',
    });
    // Members can see who else is in their room.
    this.access = {
      create: refuse,
      read: async (auth, doc) => doc.data.userId === auth.id || (await inRoom(auth, doc.data.roomId)),
      update: refuse,
      delete: refuse,
    };

    const router = sageRouter<RoomMembersSchema>(this);

    router.post(
      '/join',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const room = await needRoom(body.roomId);
        if (room.data.bans.includes(auth.id)) deny('You are banned from this room.');
        const existing = await readMember(room._id, auth.id);
        if (existing) {
          res.status(200).send({ success: true, data: [existing] });
          return;
        }

        // Create the membership first, atomically and only once, then count the invite use,
        // so a double join cannot spend two uses. A refused use undoes the membership.
        let code: string | undefined;
        let roles: string[] = [];
        if (body.code) {
          // Room PINs from before invites were stored hashed and became invites under the hash.
          const typed = String(body.code);
          const hashed = uuidv5(typed, config.namespace);
          code = (await InvitesCollection.get(inviteId(room._id, typed))) || !(await InvitesCollection.get(inviteId(room._id, hashed))) ? typed : hashed;
          const invite = await InvitesCollection.get(inviteId(room._id, code));
          if (!invite) deny('Unknown invite.', 404);
          roles = invite.data.roles.filter((id) => room.data.roles.some((role) => role.id === id));
        } else if (room.data.isPrivate && auth.id !== room.data.ownerId && !accountOf(auth).instanceAdmin) {
          deny('This room needs an invite.');
        }

        const doc = await this.add({ roomId: room._id, userId: auth.id, roles, timeoutUntil: 0 }, auth.id, memberId(room._id, auth.id));
        if (!doc) {
          res.status(200).send({ success: true, data: [await readMember(room._id, auth.id)] });
          return;
        }
        if (code) {
          try {
            await InvitesCollection.use(room._id, code);
          } catch (error) {
            await this.delete(doc._id);
            throw error;
          }
        }
        await AuditCollection.record(auth, room, 'member.join', auth.id, body.code ? `joined with invite ${body.code}` : 'joined');
        res.status(200).send({ success: true, data: [doc] });
      })
    );

    // Add someone to the room directly, with roles below your own highest role.
    router.post(
      '/add',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const room = await needRoom(body.roomId);
        if (!has(await roomPermissionsOf(auth, room._id), P.ManageMembers)) deny();
        if (typeof body.userId !== 'string' || room.data.bans.includes(body.userId)) deny('That user cannot join this room.');
        const roles = (body.roles ?? []) as string[];
        const actorRank = rank(room.data, (await readMember(room._id, auth.id))?.data, accountOf(auth));
        for (const id of roles) {
          const index = room.data.roles.findIndex((role) => role.id === id);
          if (index < 1 || index >= actorRank) deny('You can only give roles below your own.');
        }
        const doc = await this.addMember(room._id, body.userId, roles);
        await AuditCollection.record(auth, room, 'member.add', body.userId, 'added to the room');
        res.status(200).send({ success: true, data: [doc] });
      })
    );

    router.post(
      '/leave',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        await this.delete(memberId(String(body.roomId), auth.id));
        res.status(200).send({ success: true });
      })
    );

    router.post(
      '/remove',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const { room, target } = await this.moderate(auth, body.roomId, body.userId, P.ManageMembers);
        if (!target) deny('Not a member.', 404);
        await this.delete(target._id);
        await AuditCollection.record(auth, room, 'member.remove', body.userId, 'removed from the room');
        res.status(200).send({ success: true });
      })
    );

    router.post(
      '/ban',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const { room, target } = await this.moderate(auth, body.roomId, body.userId, P.ManageMembers);
        if (!room.data.bans.includes(body.userId)) {
          const result = await RoomsCollection.updateIf(room._id, auth.id, { bans: [...room.data.bans, body.userId] }, { bans: room.data.bans });
          if (result.conflict) deny('Changed by someone else. Try again.', 409);
        }
        if (target) await this.delete(target._id);
        await AuditCollection.record(auth, room, 'member.ban', body.userId, 'banned from the room');
        res.status(200).send({ success: true });
      })
    );

    router.post(
      '/unban',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const room = await needRoom(body.roomId);
        if (!has(await roomPermissionsOf(auth, room._id), P.ManageMembers)) deny();
        const bans = room.data.bans.filter((id) => id !== body.userId);
        const result = await RoomsCollection.updateIf(room._id, auth.id, { bans }, { bans: room.data.bans });
        if (result.conflict) deny('Changed by someone else. Try again.', 409);
        await AuditCollection.record(auth, room, 'member.unban', body.userId, 'unbanned');
        res.status(200).send({ success: true });
      })
    );

    // Set a member's roles. Only roles below your own highest role can be given or taken.
    router.post(
      '/roles',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const room = await needRoom(body.roomId);
        if (!has(await roomPermissionsOf(auth, room._id), P.ManageRoles)) deny();
        const target = await readMember(room._id, body.userId);
        if (!target) deny('Not a member.', 404);
        const actorRank = rank(room.data, (await readMember(room._id, auth.id))?.data, accountOf(auth));
        if (body.userId !== auth.id && rankOfMember(room.data, body.userId, target.data) >= actorRank) deny();

        const roles = body.roles as string[];
        if (!Array.isArray(roles) || roles.some((id) => typeof id !== 'string')) deny('Invalid roles.', 400);
        const changed = [...roles.filter((id) => !target.data.roles.includes(id)), ...target.data.roles.filter((id) => !roles.includes(id))];
        for (const id of changed) {
          const index = room.data.roles.findIndex((role) => role.id === id);
          if (index < 1 || index >= actorRank) deny('You can only give or take roles below your own.');
        }

        const result = await this.updateIf(target._id, auth.id, { roles }, { roles: target.data.roles });
        if (result.conflict) deny('Changed by someone else. Try again.', 409);
        const name = (id: string) => room.data.roles.find((role) => role.id === id)?.name ?? id;
        const added = roles.filter((id) => !target.data.roles.includes(id)).map(name);
        const removed = target.data.roles.filter((id) => !roles.includes(id)).map(name);
        const summary = [added.length ? `gave ${added.join(', ')}` : '', removed.length ? `took ${removed.join(', ')}` : ''].filter(Boolean).join('; ');
        if (summary) await AuditCollection.record(auth, room, 'member.roles', body.userId, summary);
        res.status(200).send({ success: true, data: [result.doc] });
      })
    );

    // Time a member out until a time (epoch milliseconds), or 0 to end it.
    router.post(
      '/timeout',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const until = Number(body.until);
        if (!Number.isFinite(until) || until < 0) deny('Invalid time.', 400);
        const { room, target } = await this.moderate(auth, body.roomId, body.userId, P.ModerateMembers);
        if (!target) deny('Not a member.', 404);
        const doc = await this.update(target._id, auth.id, { timeoutUntil: until });
        const summary = until > Date.now() ? `timed out until ${new Date(until).toISOString()}` : 'ended the timeout';
        await AuditCollection.record(auth, room, 'member.timeout', body.userId, summary);
        res.status(200).send({ success: true, data: [doc] });
      })
    );

    this.httpRouter = router;
  }

  // Check that the requester may act on a user below them in the role order.
  private async moderate(auth: SBAuthSchema, roomId: string, userId: string, permission: number) {
    const room = await needRoom(roomId);
    if (!has(await roomPermissionsOf(auth, room._id), permission)) deny();
    const target = await readMember(room._id, userId);
    const actorRank = rank(room.data, (await readMember(room._id, auth.id))?.data, accountOf(auth));
    if (rankOfMember(room.data, userId, target?.data) >= actorRank) deny('You can only act on members below you.');
    return { room, target };
  }

  // Join a user to a room. Joining twice keeps the first membership.
  public async addMember(roomId: string, userId: string, roles: string[]): Promise<SBDocument<RoomMembersSchema> | undefined> {
    const added = await this.add({ roomId, userId, roles, timeoutUntil: 0 }, userId, memberId(roomId, userId));
    return added ?? (await readMember(roomId, userId));
  }

  // Delete all the members of a specific room
  public async deleteMembersInRoom(roomId: string): Promise<number> {
    const docs = await this.query('roomId', roomId);
    if (!docs || docs.length === 0) return 0;
    const deleted = await this.deleteBatch(docs.map((doc) => doc._id));
    return deleted ? deleted.length : 0;
  }
}

async function needRoom(roomId: unknown): Promise<SBDocument<RoomSchema>> {
  const room = typeof roomId === 'string' ? await readRoom(roomId) : undefined;
  if (!room) deny('Room not found.', 404);
  return room;
}

export const RoomMembersCollection = new SAGE3RoomMembersCollection();
