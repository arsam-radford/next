/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Shared helpers for the collections' access rules.

import { AccessError, boardPermissionsOf, roomPermissionsOf } from '@sage3/backend';
import { SBAuthSchema } from '@sage3/sagebase';
import { has } from '@sage3/shared';

export function deny(message = 'Not allowed.', status = 403): never {
  throw new AccessError(message, status);
}

export async function needInRoom(auth: SBAuthSchema, roomId: string, permission: number): Promise<number> {
  const permissions = await roomPermissionsOf(auth, roomId);
  if (!has(permissions, permission)) deny();
  return permissions;
}

export async function needOnBoard(auth: SBAuthSchema, boardId: string, permission: number): Promise<number> {
  const permissions = await boardPermissionsOf(auth, boardId);
  if (!has(permissions, permission)) deny();
  return permissions;
}

export const refuse = async (): Promise<never> => deny();
