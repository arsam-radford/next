/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { z } from 'zod';
import { SBDoc } from './SBSchema';

// One document per invite, with the id inviteId(roomId, code)
const schema = z.object({
  roomId: z.string(),
  code: z.string(),
  // Role ids granted on joining
  roles: z.array(z.string()),
  // Epoch milliseconds; 0 for never
  expiresAt: z.number(),
  // 0 for unlimited
  maxUses: z.number(),
  uses: z.number(),
});

export type InviteSchema = z.infer<typeof schema>;

export type Invite = SBDoc & { data: InviteSchema };

export function inviteId(roomId: string, code: string): string {
  return `${roomId}_${code}`;
}
