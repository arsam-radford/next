/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { PresenceSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, boardPermissionsOf } from '@sage3/backend';
import { SBAuthSchema } from '@sage3/sagebase';
import { has, Permission as P } from '@sage3/shared';
import { deny, needOnBoard, refuse } from './access';

/**
 * Whether a user may see a presence: their own, anyone not on a board, or anyone on a board where they have View Presence.
 */
export async function canSeePresence(auth: SBAuthSchema, presence: PresenceSchema): Promise<boolean> {
  if (presence.userId === auth.id || !presence.boardId) return true;
  return has(await boardPermissionsOf(auth, presence.boardId), P.ViewPresence);
}

class SAGE3PresenceCollection extends SAGE3Collection<PresenceSchema> {
  constructor() {
    super('PRESENCE', {
      userId: '',
      status: 'online',
      roomId: '',
      boardId: '',
    });
    // One document per user, with the user's id. The server creates them when users connect.
    this.access = {
      create: refuse,
      read: (auth, doc) => canSeePresence(auth, doc.data),
      update: async (auth, doc, update) => {
        if ('userId' in update) deny();
        if (doc._id === auth.id) {
          if (update.boardId) await needOnBoard(auth, update.boardId, P.ViewBoard);
          return;
        }
        // Moving or following someone else is presenting to them.
        if (Object.keys(update).some((key) => key !== 'goToViewport' && key !== 'following')) deny();
        if (update.goToViewport && update.goToViewport !== auth.id) deny();
        if (update.following && update.following !== auth.id) deny();
        await needOnBoard(auth, doc.data.boardId, P.Present);
      },
      delete: refuse,
    };
    const router = sageRouter<PresenceSchema>(this);
    this.httpRouter = router;
  }
}

export const PresenceCollection = new SAGE3PresenceCollection();
