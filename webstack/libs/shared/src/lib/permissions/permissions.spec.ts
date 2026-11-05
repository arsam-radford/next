/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import {
  ALL,
  APP_PERMISSIONS,
  appPermission,
  accountFor,
  boardPermissions,
  checkOverridesChange,
  checkRolesChange,
  EVERYONE,
  has,
  parseRoleColor,
  Permission as P,
  rank,
  READ_ONLY_KEEPS,
  roomPermissions,
} from './permissions';
import { roomTemplates } from './templates';

const classroom = roomTemplates[0];
const room = { ownerId: 'owner', roles: classroom.roles };
const student = { roles: ['student'], timeoutUntil: 0 };
const ta = { roles: ['ta'], timeoutUntil: 0 };
const user = (id: string) => accountFor(id, 'user');
const open = { overrides: [] };

describe('roomPermissions', () => {
  it('combines @everyone with the member roles', () => {
    const p = roomPermissions(room, student, user('s'));
    expect(has(p, P.EditOthersApps | P.ViewBoard)).toBe(true);
    expect(has(p, P.UseAI)).toBe(false);
  });

  it('gives nothing to non-members, everything to the owner and instance admins', () => {
    expect(roomPermissions(room, undefined, user('s'))).toBe(0);
    expect(roomPermissions(room, undefined, user('owner'))).toBe(ALL);
    expect(roomPermissions(room, undefined, accountFor('x', 'admin'))).toBe(ALL);
  });

  it('caps read-only accounts, even with Administrator', () => {
    const p = roomPermissions(room, { roles: ['instructor'], timeoutUntil: 0 }, accountFor('s', 'spectator'));
    expect(p).toBe(READ_ONLY_KEEPS);
  });
});

describe('boardPermissions', () => {
  it('applies @everyone, then roles combined, then the member', () => {
    const board = {
      overrides: [
        { kind: 'role' as const, target: EVERYONE, allow: 0, deny: P.ViewBoard },
        { kind: 'role' as const, target: 'student', allow: P.ViewBoard, deny: 0 },
        { kind: 'member' as const, target: 'muted', allow: 0, deny: P.EditOthersApps },
      ],
    };
    expect(has(boardPermissions(room, board, student, user('s'), 0), P.EditOthersApps)).toBe(true);
    expect(has(boardPermissions(room, board, student, user('muted'), 0), P.EditOthersApps)).toBe(false);
    expect(boardPermissions(room, board, { roles: [], timeoutUntil: 0 }, user('v'), 0)).toBe(0);
  });

  it('lets allow win between two roles', () => {
    const board = {
      overrides: [
        { kind: 'role' as const, target: 'student', allow: 0, deny: P.Annotate },
        { kind: 'role' as const, target: 'ta', allow: P.Annotate, deny: 0 },
      ],
    };
    expect(has(boardPermissions(room, board, { roles: ['student', 'ta'], timeoutUntil: 0 }, user('s'), 0), P.Annotate)).toBe(true);
  });

  it('ignores overrides for the owner', () => {
    const board = { overrides: [{ kind: 'member' as const, target: 'owner', allow: 0, deny: P.ViewBoard }] };
    expect(boardPermissions(room, board, undefined, user('owner'), 0)).toBe(ALL);
  });

  it('removes participation during a timeout', () => {
    const p = boardPermissions(room, open, { roles: ['student'], timeoutUntil: 100 }, user('s'), 50);
    expect(has(p, P.ViewBoard)).toBe(true);
    expect(has(p, P.EditOthersApps)).toBe(false);
    expect(has(boardPermissions(room, open, { roles: ['student'], timeoutUntil: 100 }, user('s'), 150), P.EditOthersApps)).toBe(true);
  });
});

describe('checkRolesChange', () => {
  const taRank = rank(room, ta, user('t'));

  it('lets a TA change roles below them with bits they hold', () => {
    const after = room.roles.map((role) => (role.id === 'student' ? { ...role, permissions: role.permissions | P.Present } : role));
    expect(checkRolesChange(room.roles, after, taRank, roomPermissions(room, ta, user('t')))).toBeUndefined();
  });

  it('refuses granting bits the actor lacks', () => {
    const after = room.roles.map((role) => (role.id === 'student' ? { ...role, permissions: role.permissions | P.ManageRoles } : role));
    expect(checkRolesChange(room.roles, after, taRank, roomPermissions(room, ta, user('t')))).toMatch(/permissions you have/);
  });

  it('refuses touching roles at or above the actor', () => {
    const after = room.roles.map((role) => (role.id === 'ta' ? { ...role, name: 'Assistant' } : role));
    expect(checkRolesChange(room.roles, after, taRank, ALL)).toMatch(/highest role/);
    expect(checkRolesChange(room.roles, [room.roles[0], room.roles[1], room.roles[3]], taRank, ALL)).toMatch(/highest role/);
  });

  it('keeps @everyone first', () => {
    expect(checkRolesChange(room.roles, room.roles.slice(1), room.roles.length, ALL)).toMatch(/@everyone/);
  });
});

describe('checkOverridesChange', () => {
  it('refuses room permissions, unknown roles and bits the actor lacks', () => {
    const allow = (bits: number, target = 'student') => [{ kind: 'role' as const, target, allow: bits, deny: 0 }];
    expect(checkOverridesChange([], allow(P.ManageRoles), room.roles, ALL)).toMatch(/cannot hold/);
    expect(checkOverridesChange([], allow(P.Annotate, 'nobody'), room.roles, ALL)).toMatch(/unknown role/);
    expect(checkOverridesChange([], allow(P.UseAI), room.roles, P.Annotate)).toMatch(/permissions you have/);
    expect(checkOverridesChange([], allow(P.Annotate), room.roles, P.Annotate)).toBeUndefined();
  });
});

describe('app overrides', () => {
  const app = (overrides: { kind: 'role' | 'member'; target: string; allow: number; deny: number }[]) => ({ overrides });

  it('apply on top of the board, @everyone then roles then the member', () => {
    const locked = app([{ kind: 'role', target: EVERYONE, allow: 0, deny: P.EditOthersApps }]);
    expect(has(boardPermissions(room, open, student, user('s'), 0, locked), P.EditOthersApps)).toBe(false);
    expect(has(boardPermissions(room, open, student, user('s'), 0, locked), P.InteractWithApps)).toBe(true);
    const opened = app([{ kind: 'role', target: 'student', allow: P.DeleteOthersApps, deny: 0 }]);
    expect(has(boardPermissions(room, open, student, user('s'), 0, opened), P.DeleteOthersApps)).toBe(true);
  });

  it('ignore rules for one person', () => {
    const personal = app([{ kind: 'member', target: 's', allow: 0, deny: P.InteractWithApps }]);
    expect(has(boardPermissions(room, open, student, user('s'), 0, personal), P.InteractWithApps)).toBe(true);
  });

  it('cannot lift a timeout or the read-only cap, and never restrict the owner', () => {
    const allowEdit = app([{ kind: 'role', target: EVERYONE, allow: P.EditOthersApps, deny: 0 }]);
    expect(has(boardPermissions(room, open, { roles: ['student'], timeoutUntil: 100 }, user('s'), 50, allowEdit), P.EditOthersApps)).toBe(false);
    expect(has(boardPermissions(room, open, student, accountFor('v', 'spectator'), 0, allowEdit), P.EditOthersApps)).toBe(false);
    const denyAll = app([{ kind: 'member', target: 'owner', allow: 0, deny: APP_PERMISSIONS }]);
    expect(boardPermissions(room, open, undefined, user('owner'), 0, denyAll)).toBe(ALL);
  });

  it('only hold app permissions', () => {
    const viewOff = [{ kind: 'role' as const, target: EVERYONE, allow: 0, deny: P.ViewBoard }];
    expect(checkOverridesChange([], viewOff, room.roles, ALL, APP_PERMISSIONS)).toMatch(/cannot hold/);
  });
});

describe('appPermission', () => {
  it('picks the own or others variant', () => {
    expect(appPermission('Edit', true)).toBe(P.EditOwnApps);
    expect(appPermission('Delete', false)).toBe(P.DeleteOthersApps);
  });
});

describe('parseRoleColor', () => {
  it('reads hex and r, g, b', () => {
    expect(parseRoleColor('#E07A2F')).toBe('#e07a2f');
    expect(parseRoleColor('e07a2f')).toBe('#e07a2f');
    expect(parseRoleColor(' 224, 122,47 ')).toBe('#e07a2f');
  });
  it('refuses anything else', () => {
    expect(parseRoleColor('256, 0, 0')).toBeUndefined();
    expect(parseRoleColor('#abc')).toBeUndefined();
    expect(parseRoleColor('teal')).toBeUndefined();
  });
});
