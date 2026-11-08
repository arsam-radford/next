/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { z } from 'zod';
import { SBDoc } from './SBSchema';

// One document per user per room, with the id memberId(roomId, userId)
const schema = z.object({
  roomId: z.string(),
  userId: z.string(),
  // Role ids, not including @everyone
  roles: z.array(z.string()),
  // Epoch milliseconds; 0 when not timed out
  timeoutUntil: z.number(),
});

export type RoomMembersSchema = z.infer<typeof schema>;

export type RoomMembers = SBDoc & { data: RoomMembersSchema };

export function memberId(roomId: string, userId: string): string {
  return `${roomId}_${userId}`;
}
