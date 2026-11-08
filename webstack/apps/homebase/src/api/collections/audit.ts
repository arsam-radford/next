/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { AuditSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, accountOf, canInRoom } from '@sage3/backend';
import { SBAuthSchema } from '@sage3/sagebase';
import { Permission } from '@sage3/shared';

import { refuse } from './access';

// The room audit log. Only the server writes it; entries expire after the configured number of days.
class SAGE3AuditCollection extends SAGE3Collection<AuditSchema> {
  constructor() {
    super('AUDIT', { roomId: '' });
    this.access = {
      create: refuse,
      read: (auth, doc) => canInRoom(auth, doc.data.roomId, Permission.ViewAuditLog),
      update: refuse,
      delete: refuse,
    };
    this.httpRouter = sageRouter<AuditSchema>(this);
  }

  public async record(auth: SBAuthSchema, room: { _id: string; data: { ownerId: string } }, action: string, target: string, summary: string) {
    const asInstanceAdmin = accountOf(auth).instanceAdmin && auth.id !== room.data.ownerId;
    await this.add({ roomId: room._id, action, target, summary, asInstanceAdmin }, auth.id);
  }
}

export const AuditCollection = new SAGE3AuditCollection();
