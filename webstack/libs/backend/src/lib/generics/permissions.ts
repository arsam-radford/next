/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Server side of the permission system: resolves who is asking and what they may do
// in a room or on a board. The calculation itself lives in @sage3/shared.

import { createHmac } from 'node:crypto';
import { SAGEBase, SBAuthSchema, SBCollectionRef, SBDocument } from '@sage3/sagebase';
import { ALL, Account, accountFor, AppAccess, applyAppOverrides, boardBase, finishPermissions, has, MemberAccess, roomPermissions } from '@sage3/shared';
import { BoardSchema, memberId, RoomMembersSchema, RoomSchema } from '@sage3/shared/types';

// Instance role per login provider. LDAP resolves its own role at login.
const providerRoles: Record<string, string> = {
  admin: 'admin',
  cilogon: 'user',
  google: 'user',
  apple: 'user',
  jwt: 'user',
  keycloak: 'user',
  ldap: 'user',
  spectator: 'spectator',
  guest: 'guest',
};

export function instanceRole(auth: SBAuthSchema): string | undefined {
  if (auth.email && admins.includes(auth.email)) return 'admin';
  if (auth.provider === 'ldap' && auth.role) return auth.role;
  return providerRoles[auth.provider];
}

let admins: string[] = [];
let secret = '';
let restrictRoomCreation = false;
let rooms: SBCollectionRef<RoomSchema>;
let boards: SBCollectionRef<BoardSchema>;
let members: SBCollectionRef<RoomMembersSchema>;

// Computed permissions per `${userId} ${roomId} ` and `${userId}  ${boardId}`. Cleared whenever a room,
// board or membership changes, so a change applies to the next check.
// Each entry holds a result before timeouts and caps, and the membership it came from, so a timeout
// that ends, or an app's own overrides, apply at use without recomputing.
type Entry = { base: number; member?: MemberAccess };
const memo = new Map<string, Entry>();
let epoch = 0;

/**
 * Connect to the room, board and membership collections. Call once per server, after SAGEBase.init.
 */
export async function initPermissions(options: { admins: string[]; restrictRoomCreation: boolean; secret: string }): Promise<void> {
  admins = options.admins;
  secret = options.secret;
  restrictRoomCreation = options.restrictRoomCreation;
  rooms = await SAGEBase.Database.collection<RoomSchema>('ROOMS');
  boards = await SAGEBase.Database.collection<BoardSchema>('BOARDS');
  members = await SAGEBase.Database.collection<RoomMembersSchema>('ROOMMEMBERS');
  const invalidate = () => {
    epoch++;
    memo.clear();
  };
  await rooms.subscribe(invalidate);
  await boards.subscribe(invalidate);
  await members.subscribe(invalidate);
}

/**
 * The token of a file's public share link. Only the server can make one, so links come from a permission check.
 */
export function fileToken(assetId: string): string {
  return createHmac('sha256', secret).update(assetId).digest('hex');
}

export function accountOf(auth: SBAuthSchema): Account {
  return accountFor(auth.id, instanceRole(auth), restrictRoomCreation);
}

export function readRoom(roomId: string): Promise<SBDocument<RoomSchema> | undefined> {
  return rooms.docRef(roomId).read();
}

export function readBoard(boardId: string): Promise<SBDocument<BoardSchema> | undefined> {
  return boards.docRef(boardId).read();
}

export function readMember(roomId: string, userId: string): Promise<SBDocument<RoomMembersSchema> | undefined> {
  return members.docRef(memberId(roomId, userId)).read();
}

/**
 * Room permissions of the requester. 0 when the room does not exist.
 */
export async function roomPermissionsOf(auth: SBAuthSchema, roomId: string): Promise<number> {
  const { base } = await remember(`${auth.id} ${roomId} `, async () => {
    const [room, member] = await Promise.all([readRoom(roomId), readMember(roomId, auth.id)]);
    return { base: room ? roomPermissions(room.data, member?.data, accountOf(auth)) : 0 };
  });
  return base;
}

// The board's result before timeouts and caps. Pass the board's data to check a board that was just deleted.
function boardEntry(auth: SBAuthSchema, boardId: string, known?: BoardSchema): Promise<Entry> {
  return remember(`${auth.id}  ${boardId}`, async () => {
    const board = known ?? (await readBoard(boardId))?.data;
    if (!board) return { base: 0 };
    const [room, member] = await Promise.all([readRoom(board.roomId), readMember(board.roomId, auth.id)]);
    if (!room) return { base: 0 };
    return { base: boardBase(room.data, board, member?.data, accountOf(auth)), member: member?.data };
  });
}

/**
 * Board permissions of the requester, in the board's room. 0 when the board does not exist.
 */
export async function boardPermissionsOf(auth: SBAuthSchema, boardId: string, known?: BoardSchema): Promise<number> {
  const { base, member } = await boardEntry(auth, boardId, known);
  return finishPermissions(base, member, accountOf(auth), Date.now());
}

/**
 * Permissions on one app: its board's, adjusted by the app's own overrides.
 */
export async function appPermissionsOf(auth: SBAuthSchema, app: { boardId: string } & AppAccess): Promise<number> {
  const { base, member } = await boardEntry(auth, app.boardId);
  const p = member && base !== ALL ? applyAppOverrides(base, app, member.roles) : base;
  return finishPermissions(p, member, accountOf(auth), Date.now());
}

/**
 * Whether the requester is a member of the room, or its owner or an instance administrator.
 */
export async function inRoom(auth: SBAuthSchema, roomId: string): Promise<boolean> {
  const { base } = await remember(`${auth.id} ${roomId} member`, async () => {
    const [room, member] = await Promise.all([readRoom(roomId), readMember(roomId, auth.id)]);
    return { base: room && (member || room.data.ownerId === auth.id || accountOf(auth).instanceAdmin) ? 1 : 0 };
  });
  return base === 1;
}

// The rooms a user is in: owned, joined, or (for the people who manage them) banned from.
// shortcut: reads one membership per room, since this collection handle has no search index; fine for hundreds of rooms, query by userId past that.
async function roomsOf(userId: string): Promise<string[]> {
  const all = (await rooms.getAllDocs()) ?? [];
  const inside = await Promise.all(
    all.map(async (room) => room.data.ownerId === userId || room.data.bans.includes(userId) || !!(await readMember(room._id, userId)))
  );
  return all.filter((_room, i) => inside[i]).map((room) => room._id);
}

/**
 * Whether the requester may see a user's account: their own, anyone they share a room with, or anyone for administrators.
 */
export async function sharesRoom(auth: SBAuthSchema, userId: string): Promise<boolean> {
  if (userId === auth.id || accountOf(auth).instanceAdmin) return true;
  const { base } = await remember(`${auth.id} ${userId} shares`, async () => {
    const [mine, theirs] = await Promise.all([roomsOf(auth.id), roomsOf(userId)]);
    return { base: theirs.some((id) => mine.includes(id)) ? 1 : 0 };
  });
  return base === 1;
}

export async function canInRoom(auth: SBAuthSchema, roomId: string, permission: number): Promise<boolean> {
  return has(await roomPermissionsOf(auth, roomId), permission);
}

export async function canOnBoard(auth: SBAuthSchema, boardId: string, permission: number): Promise<boolean> {
  return has(await boardPermissionsOf(auth, boardId), permission);
}

async function remember(key: string, compute: () => Promise<Entry>): Promise<Entry> {
  const known = memo.get(key);
  if (known) return known;
  const started = epoch;
  const entry = await compute();
  // A change during the computation may have made it stale.
  if (epoch === started) memo.set(key, entry);
  return entry;
}
