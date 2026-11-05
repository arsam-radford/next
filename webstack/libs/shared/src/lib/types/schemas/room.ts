/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { z } from 'zod';
import { SBDoc } from './SBSchema';
import { RoleSchema } from '../../permissions/permissions';

const schema = z.object({
  // Name of the Room
  name: z.string(),
  // Description of the room.
  description: z.string(),
  // Color of the room.
  color: z.string(),
  // The ID of the owner of the room
  ownerId: z.string(),
  // Joining needs an invite
  isPrivate: z.boolean(),
  // Is the room listed publicly?
  isListed: z.boolean(),
  // Ordered from lowest to highest. roles[0] is @everyone.
  roles: z.array(RoleSchema),
  // Users who cannot join
  bans: z.array(z.string()),
});

export type RoomSchema = z.infer<typeof schema>;

export type Room = SBDoc & { data: RoomSchema };
