/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { InviteSchema, inviteId } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, accountOf, canInRoom, guarded, readMember, readRoom, roomPermissionsOf } from '@sage3/backend';
import { SBAuthSchema } from '@sage3/sagebase';
import { generateReadableID, has, Permission as P, rank } from '@sage3/shared';

import { deny, refuse } from './access';
import { AuditCollection } from './audit';

// Invites and join codes: one document per invite, with the id inviteId(roomId, code).
class SAGE3InvitesCollection extends SAGE3Collection<InviteSchema> {
  constructor() {
    super('INVITES', { roomId: '' });
    this.access = {
      create: refuse,
      read: (auth, doc) => canInRoom(auth, doc.data.roomId, P.ManageMembers),
      update: refuse,
      delete: async (auth, doc) => {
        if (!(await canInRoom(auth, doc.data.roomId, P.ManageMembers))) deny();
      },
      written: async (auth, before) => {
        const room = before && (await readRoom(before.data.roomId));
        if (room) await AuditCollection.record(auth, room, 'invite.revoke', before._id, `revoked invite ${before.data.code}`);
      },
    };
    const router = sageRouter<InviteSchema>(this);

    // Create an invite. It can only grant roles below the creator's own highest role.
    router.post(
      '/create',
      guarded(async ({ body, user }, res) => {
        const auth = user as SBAuthSchema;
        const room = await readRoom(String(body.roomId));
        if (!room) deny('Room not found.', 404);
        if (!has(await roomPermissionsOf(auth, room._id), P.ManageMembers)) deny();
        const roles = (body.roles ?? []) as string[];
        const actorRank = rank(room.data, (await readMember(room._id, auth.id))?.data, accountOf(auth));
        for (const id of roles) {
          const index = room.data.roles.findIndex((role) => role.id === id);
          if (index < 1 || index >= actorRank) deny('An invite can only grant roles below your own.');
        }

        const code = body.code ? String(body.code) : generateReadableID();
        if (!/^[A-Za-z0-9-]{1,64}$/.test(code)) deny('Codes use letters, digits and dashes.', 400);
        const data = { roomId: room._id, code, roles, expiresAt: Number(body.expiresAt) || 0, maxUses: Number(body.maxUses) || 0, uses: 0 };
        const doc = await this.add(data, auth.id, inviteId(room._id, code));
        if (!doc) deny('That code is already in use.', 409);
        await AuditCollection.record(auth, room, 'invite.create', doc._id, `created invite ${code}`);
        res.status(200).send({ success: true, data: [doc] });
      })
    );

    this.httpRouter = router;
  }

  /**
   * Count one use of an invite, atomically. Throws when it is unknown, expired or used up.
   */
  public async use(roomId: string, code: string): Promise<InviteSchema> {
    for (;;) {
      const invite = await this.get(inviteId(roomId, code));
      if (!invite) deny('Unknown invite.', 404);
      const { expiresAt, maxUses, uses } = invite.data;
      if ((expiresAt && expiresAt < Date.now()) || (maxUses && uses >= maxUses)) deny('This invite has expired.');
      const result = await this.updateIf(invite._id, invite._createdBy, { uses: uses + 1 }, { uses });
      if (result.success) return invite.data;
      if (!result.conflict) deny('Failed to use the invite.', 500);
    }
  }
}

export const InvitesCollection = new SAGE3InvitesCollection();
