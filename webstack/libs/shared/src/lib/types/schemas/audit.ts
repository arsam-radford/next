/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { z } from 'zod';
import { SBDoc } from './SBSchema';

// One document per moderation or permission change. _createdBy and _createdAt record who and when.
const schema = z.object({
  roomId: z.string(),
  // For example 'role.update', 'member.ban', 'board.overrides'
  action: z.string(),
  // Id of the role, member, board, invite, app or file acted on
  target: z.string(),
  // For example 'allowed Use AI, denied Chat'
  summary: z.string(),
  // True when the actor acted as an instance administrator
  asInstanceAdmin: z.boolean(),
});

export type AuditSchema = z.infer<typeof schema>;

export type Audit = SBDoc & { data: AuditSchema };
