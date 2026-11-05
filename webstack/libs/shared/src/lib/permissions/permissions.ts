/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Room roles and board overrides, after Discord. See doc/Permissions-Design.md.
// The same functions run on the server (authoritative) and the client (UI only).

import { z } from 'zod';

// Each permission is one bit. Bits 0-8 are room permissions, 9-30 board permissions.
// App permissions come in pairs: for the person's own apps, and for other people's.
export const Permission = {
  Administrator: 1 << 0,
  ManageRoom: 1 << 1,
  ManageRoles: 1 << 2,
  ManageMembers: 1 << 3,
  ModerateMembers: 1 << 4,
  ManageBoards: 1 << 5,
  ManagePlugins: 1 << 6,
  ViewAuditLog: 1 << 7,
  UploadPlugins: 1 << 8,

  ViewBoard: 1 << 9,
  CreateApps: 1 << 10,
  InteractWithApps: 1 << 11,
  EditOwnApps: 1 << 12,
  EditOthersApps: 1 << 13,
  ArrangeOwnApps: 1 << 14,
  ArrangeOthersApps: 1 << 15,
  DeleteOwnApps: 1 << 16,
  DeleteOthersApps: 1 << 17,
  UploadAssets: 1 << 18,
  BrowseOthersAssets: 1 << 19,
  DownloadOthersAssets: 1 << 20,
  ManageOthersAssets: 1 << 21,
  UsePlugins: 1 << 22,
  PlacePlugins: 1 << 23,
  Annotate: 1 << 24,
  UseAI: 1 << 25,
  ExecuteCode: 1 << 26,
  Screenshare: 1 << 27,
  Present: 1 << 28,
  ViewPresence: 1 << 29,
  Chat: 1 << 30,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL = 2 ** 31 - 1;
export const ROOM_PERMISSIONS = (1 << 9) - 1;
export const BOARD_PERMISSIONS = ALL & ~ROOM_PERMISSIONS;

const P = Permission;

// What an app's own overrides can change: what people may do with it, never whether they see it.
export const APP_PERMISSIONS =
  P.InteractWithApps | P.EditOwnApps | P.EditOthersApps | P.ArrangeOwnApps | P.ArrangeOthersApps | P.DeleteOwnApps | P.DeleteOthersApps;

/**
 * The permission to edit, arrange (move, resize, pin) or delete an app, depending on whose it is.
 */
export function appPermission(action: 'Edit' | 'Arrange' | 'Delete', own: boolean): number {
  return P[`${action}${own ? 'Own' : 'Others'}Apps`];
}

// What a timeout takes away, whatever roles and overrides say.
export const TIMEOUT_REMOVES =
  APP_PERMISSIONS | P.CreateApps | P.UploadAssets | P.UsePlugins | P.PlacePlugins | P.Annotate | P.Chat | P.Screenshare | P.Present;

// All a read-only account (spectator login) can ever do in a room.
export const READ_ONLY_KEEPS = P.ViewBoard | P.BrowseOthersAssets | P.DownloadOthersAssets | P.ViewPresence;

// @everyone is always roles[0] and has this id.
export const EVERYONE = 'everyone';

const permissionBits = z.number().int().min(0).max(ALL);

export const RoleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string(),
  permissions: permissionBits,
  // Only changes how the UI lists the role.
  group: z.boolean(),
});
export type Role = z.infer<typeof RoleSchema>;

/**
 * A role color typed as hex ("#e07a2f") or as red, green, blue ("224, 122, 47"), as lowercase hex.
 * Undefined when it is neither. Roles also keep palette names such as "teal".
 */
export function parseRoleColor(text: string): string | undefined {
  const t = text.trim();
  if (/^#?[0-9a-f]{6}$/i.test(t)) return `#${t.replace('#', '').toLowerCase()}`;
  const rgb = t.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (!rgb) return undefined;
  const parts = rgb.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return undefined;
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export const OverrideSchema = z.object({
  kind: z.enum(['role', 'member']),
  // A role id, or a user id for a member override.
  target: z.string().min(1),
  allow: permissionBits,
  deny: permissionBits,
});
export type Override = z.infer<typeof OverrideSchema>;

// Ordered from lowest to highest. The order is the role hierarchy.
export const RolesSchema = z
  .array(RoleSchema)
  .min(1)
  .refine((roles) => roles[0].id === EVERYONE, '@everyone must be the first role.')
  .refine((roles) => roles.every((role, i) => roles.findIndex((other) => other.id === role.id) === i), 'Role ids must be unique.');

export const OverridesSchema = z
  .array(OverrideSchema)
  .refine(
    (list) => list.every((o, i) => list.findIndex((other) => other.kind === o.kind && other.target === o.target) === i),
    'One override per target.'
  );

// What the permission functions need from a room, a board and a membership.
export type RoomAccess = { ownerId: string; roles: Role[] };
export type BoardAccess = { overrides: Override[] };
export type AppAccess = { overrides?: Override[] };
export type MemberAccess = { roles: string[]; timeoutUntil: number };

// Instance-level facts about the account making a request.
export type Account = { userId: string; instanceAdmin: boolean; createRooms: boolean; readOnly: boolean };

/**
 * Derive the account from the resolved instance role.
 * `restrictRoomCreation` limits Create Rooms to instance administrators.
 */
export function accountFor(userId: string, role: string | undefined, restrictRoomCreation = false): Account {
  const instanceAdmin = role === 'admin';
  return {
    userId,
    instanceAdmin,
    createRooms: instanceAdmin || (role === 'user' && !restrictRoomCreation),
    readOnly: role === 'spectator',
  };
}

/**
 * Room permissions: @everyone combined with all the member's roles.
 * Not a member (and not owner or instance admin) means no permissions.
 */
export function roomPermissions(room: RoomAccess, member: MemberAccess | undefined, account: Account): number {
  if (account.instanceAdmin || account.userId === room.ownerId) return ALL;
  if (!member) return 0;

  let p = room.roles[0].permissions;
  for (const role of room.roles) {
    if (member.roles.includes(role.id)) p |= role.permissions;
  }

  if (p & P.Administrator) p = ALL;
  if (account.readOnly) p &= READ_ONLY_KEEPS;
  return p;
}

/**
 * Apply one layer of overrides: @everyone, then all of the member's roles combined, then the member.
 */
export function applyOverrides(p: number, overrides: Override[], memberRoles: string[], userId: string): number {
  let allow = 0;
  let deny = 0;
  for (const o of overrides) {
    if (o.kind === 'role' && o.target === EVERYONE) p = (p & ~o.deny) | o.allow;
  }
  for (const o of overrides) {
    if (o.kind === 'role' && o.target !== EVERYONE && memberRoles.includes(o.target)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  p = (p & ~deny) | allow;
  for (const o of overrides) {
    if (o.kind === 'member' && o.target === userId) p = (p & ~o.deny) | o.allow;
  }
  return p;
}

/**
 * Apply an app's own overrides. They are for roles only; rules for one person stay on boards.
 */
export function applyAppOverrides(p: number, app: AppAccess, memberRoles: string[]): number {
  return applyOverrides(p, (app.overrides ?? []).filter((o) => o.kind === 'role'), memberRoles, '');
}

/**
 * Board permissions before timeouts and caps: room permissions adjusted by the board's overrides.
 * ALL for the owner and administrators, whom overrides never restrict.
 */
export function boardBase(room: RoomAccess, board: BoardAccess, member: MemberAccess | undefined, account: Account): number {
  const p = roomPermissions(room, member, account);
  if (p === ALL) return ALL;
  return member ? applyOverrides(p, board.overrides, member.roles, account.userId) : 0;
}

/**
 * View Board gates everything; then timeouts and the read-only cap apply, whatever the overrides say.
 */
export function finishPermissions(p: number, member: MemberAccess | undefined, account: Account, now: number): number {
  if (p === ALL) return ALL;
  if (!(p & P.ViewBoard)) return 0;
  if (member && member.timeoutUntil > now) p &= ~TIMEOUT_REMOVES;
  if (account.readOnly) p &= READ_ONLY_KEEPS;
  return p;
}

/**
 * Permissions on a board, or on one app of it when given: room, then board overrides, then the app's own.
 */
export function boardPermissions(
  room: RoomAccess,
  board: BoardAccess,
  member: MemberAccess | undefined,
  account: Account,
  now: number,
  app?: AppAccess
): number {
  let p = boardBase(room, board, member, account);
  if (app && member && p !== ALL) p = applyAppOverrides(p, app, member.roles);
  return finishPermissions(p, member, account, now);
}

/**
 * Position in the role hierarchy: the index of the member's highest role.
 * The owner and instance administrators rank above every role.
 */
export function rank(room: RoomAccess, member: MemberAccess | undefined, account: Account): number {
  if (account.instanceAdmin || account.userId === room.ownerId) return room.roles.length;
  let highest = 0;
  if (member) {
    room.roles.forEach((role, i) => {
      if (member.roles.includes(role.id)) highest = i;
    });
  }
  return highest;
}

export function rankOfMember(room: RoomAccess, userId: string, member: MemberAccess | undefined): number {
  if (userId === room.ownerId) return room.roles.length;
  let highest = 0;
  if (member) {
    room.roles.forEach((role, i) => {
      if (member.roles.includes(role.id)) highest = i;
    });
  }
  return highest;
}

/**
 * Check a change to a room's roles. Roles at or above the actor's own highest role
 * must stay unchanged at the top, and changed bits must be bits the actor holds.
 * Returns an error message, or undefined when the change is allowed.
 */
export function checkRolesChange(before: Role[], after: Role[], actorRank: number, actorPermissions: number): string | undefined {
  const parsed = RolesSchema.safeParse(after);
  if (!parsed.success) return parsed.error.issues[0].message;

  const locked = before.slice(actorRank);
  const top = after.slice(after.length - locked.length);
  if (locked.length > after.length || !locked.every((role, i) => sameRole(role, top[i]))) {
    return 'Roles at or above your highest role cannot be changed.';
  }

  for (const role of after.slice(0, after.length - locked.length)) {
    const old = before.find((r) => r.id === role.id);
    const changed = old ? old.permissions ^ role.permissions : role.permissions;
    if (changed & ~actorPermissions) return 'You can only grant or remove permissions you have.';
  }
  return undefined;
}

/**
 * Check a change to a board's or an app's overrides. They only hold bits in `mask`, changed bits must be
 * bits the actor holds, and role overrides must target roles that exist.
 */
export function checkOverridesChange(
  before: Override[],
  after: Override[],
  roles: Role[],
  actorPermissions: number,
  mask = BOARD_PERMISSIONS
): string | undefined {
  const parsed = OverridesSchema.safeParse(after);
  if (!parsed.success) return parsed.error.issues[0].message;
  if (after.some((o) => (o.allow | o.deny) & ~mask)) return 'These overrides cannot hold those permissions.';

  for (const o of after) {
    if (o.kind === 'role' && !roles.some((role) => role.id === o.target)) return 'Override targets an unknown role.';
  }
  const targets = [...before, ...after];
  for (const t of targets) {
    const a = before.find((o) => o.kind === t.kind && o.target === t.target);
    const b = after.find((o) => o.kind === t.kind && o.target === t.target);
    const changed = ((a?.allow ?? 0) ^ (b?.allow ?? 0)) | ((a?.deny ?? 0) ^ (b?.deny ?? 0));
    if (changed & ~actorPermissions) return 'You can only allow or deny permissions you have.';
  }
  return undefined;
}

function sameRole(a: Role, b: Role | undefined): boolean {
  return !!b && a.id === b.id && a.name === b.name && a.color === b.color && a.permissions === b.permissions && a.group === b.group;
}

export function has(permissions: number, permission: number): boolean {
  return (permissions & permission) === permission;
}

// Readable names, for example ['Use AI', "Edit Others' Apps"]. People see files, not assets, and "arrange" said too little.
export function permissionNames(bits: number): string[] {
  const names: string[] = [];
  for (const [name, bit] of Object.entries(Permission)) {
    if (bits & bit)
      names.push(
        name
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace('Others ', "Others' ")
          .replace('Arrange', 'Move, Resize and Pin')
          .replace('Assets', 'Files')
      );
  }
  return names;
}

// For the audit log, for example 'allowed Use AI; removed Annotate'.
export function describeChange(before: number, after: number, added = 'allowed', removed = 'removed'): string {
  const parts: string[] = [];
  if (after & ~before) parts.push(`${added} ${permissionNames(after & ~before).join(', ')}`);
  if (before & ~after) parts.push(`${removed} ${permissionNames(before & ~after).join(', ')}`);
  return parts.join('; ');
}

// A private board: hidden from @everyone, visible to whoever an override allows.
export function isPrivateBoard(board: BoardAccess): boolean {
  return board.overrides.some((o) => o.kind === 'role' && o.target === EVERYONE && (o.deny & Permission.ViewBoard) !== 0);
}

/**
 * Overrides that make a board private (visible to its owner and to anyone already allowed), or public again.
 */
export function withPrivacy(overrides: Override[], isPrivate: boolean, ownerId: string): Override[] {
  const rest = overrides.filter((o) => !(o.kind === 'role' && o.target === EVERYONE));
  const everyone = overrides.find((o) => o.kind === 'role' && o.target === EVERYONE) ?? { kind: 'role' as const, target: EVERYONE, allow: 0, deny: 0 };
  const deny = isPrivate ? everyone.deny | Permission.ViewBoard : everyone.deny & ~Permission.ViewBoard;
  const next = deny || everyone.allow ? [{ ...everyone, deny }, ...rest] : rest;
  if (isPrivate && !next.some((o) => o.kind === 'member' && o.target === ownerId)) {
    next.push({ kind: 'member', target: ownerId, allow: Permission.ViewBoard, deny: 0 });
  }
  return next;
}
