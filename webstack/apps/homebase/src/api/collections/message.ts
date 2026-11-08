/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { MessageSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter } from '@sage3/backend';
import { deny } from './access';

class SAGE3MessageCollection extends SAGE3Collection<MessageSchema> {
  constructor() {
    super('MESSAGE', { type: '' });
    // Notifications, such as upload progress. Each user only sees and changes their own.
    this.access = {
      create: async (_auth, data) => data,
      read: async (auth, doc) => doc._createdBy === auth.id,
      update: async (auth, doc) => {
        if (doc._createdBy !== auth.id) deny();
      },
      delete: async (auth, doc) => {
        if (doc._createdBy !== auth.id) deny();
      },
    };
    const router = sageRouter<MessageSchema>(this);
    this.httpRouter = router;
  }
}

export const MessageCollection = new SAGE3MessageCollection();
