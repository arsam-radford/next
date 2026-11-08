/**
 * Copyright (c) SAGE3 Development Team 2025. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { LinkSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, boardPermissionsOf } from '@sage3/backend';
import { has, Permission as P } from '@sage3/shared';
import { deny, needOnBoard } from './access';

class SAGE3LinkCollection extends SAGE3Collection<LinkSchema> {
  constructor() {
    super('LINK', { boardId: '' });
    // Links between apps belong to their board, and change with Edit Apps.
    this.access = {
      create: async (auth, data) => {
        await needOnBoard(auth, data.boardId, P.EditOwnApps);
        return data;
      },
      read: async (auth, doc) => has(await boardPermissionsOf(auth, doc.data.boardId), P.ViewBoard),
      update: async (auth, doc, update) => {
        if ('boardId' in update) deny('boardId cannot be changed.');
        await needOnBoard(auth, doc.data.boardId, P.EditOwnApps);
      },
      delete: async (auth, doc) => {
        await needOnBoard(auth, doc.data.boardId, P.EditOwnApps);
      },
    };
    const router = sageRouter<LinkSchema>(this);
    this.httpRouter = router;
  }
}

export const LinkCollection = new SAGE3LinkCollection();
