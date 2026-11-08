/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Groups are roles with the group flag; a group board is a board only that group can see.

import { EVERYONE, generateReadableID, groupRole, Override, Permission, Role, roomTemplates } from '@sage3/shared';
import { Room, RoomMembers } from '@sage3/shared/types';

import { APIHttp, SocketAPI } from '../api';

export function groupBoardOverrides(roleId: string): Override[] {
  return [
    { kind: 'role', target: EVERYONE, allow: 0, deny: Permission.ViewBoard },
    { kind: 'role', target: roleId, allow: Permission.ViewBoard, deny: 0 },
  ];
}

/**
 * Add `count` group roles just above @everyone, and optionally one board per group that only it can see.
 */
export async function createGroups(room: Room, count: number, withBoards: boolean, ownerId: string): Promise<string | undefined> {
  const groups: Role[] = [];
  for (let n = 1; groups.length < count; n++) {
    if (!room.data.roles.some((role) => role.id === `group-${n}`)) groups.push(groupRole(n));
  }
  const roles = [room.data.roles[0], ...groups, ...room.data.roles.slice(1)];
  const res = await APIHttp.POST<any>(`/rooms/${room._id}/roles`, { roles, before: room.data.roles });
  if (!res.success) return res.message;
  if (!withBoards) return undefined;
  for (const group of groups) {
    const board = {
      name: group.name,
      description: `${group.name}'s board`,
      color: 'purple',
      roomId: room._id,
      ownerId,
      code: generateReadableID(),
      overrides: groupBoardOverrides(group.id),
      executeInfo: { executeFunc: '', params: {} },
    };
    const created = await SocketAPI.sendRESTMessage('/boards', 'POST', board);
    if (!created.success) return created.message;
  }
  return undefined;
}

/**
 * Spread the room's students (members without other roles than Student and groups) evenly and randomly over the groups.
 */
export async function assignGroups(room: Room, members: RoomMembers[]): Promise<string | undefined> {
  const groups = room.data.roles.filter((role) => role.group).map((role) => role.id);
  if (groups.length === 0) return 'Create groups first.';
  const isStudent = (m: RoomMembers) => m.data.userId !== room.data.ownerId && m.data.roles.every((id) => id === 'student' || groups.includes(id));
  const students = members.filter((m) => m.data.roomId === room._id && isStudent(m));
  for (let i = students.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [students[i], students[j]] = [students[j], students[i]];
  }
  for (let i = 0; i < students.length; i++) {
    const roles = [...students[i].data.roles.filter((id) => !groups.includes(id)), groups[i % groups.length]];
    const res = await APIHttp.POST<any>('/roommembers/roles', { roomId: room._id, userId: students[i].data.userId, roles });
    if (!res.success) return res.message;
  }
  return undefined;
}

/**
 * Remove the group roles. Group boards stay, visible to staff.
 */
export async function dissolveGroups(room: Room): Promise<string | undefined> {
  const roles = room.data.roles.filter((role) => !role.group);
  const res = await APIHttp.POST<any>(`/rooms/${room._id}/roles`, { roles, before: room.data.roles });
  return res.success ? undefined : res.message;
}

/**
 * Create one room per group, owned by the caller, where the group's members are Project Leads with Administrator.
 */
export async function spinOffGroupRooms(room: Room, members: RoomMembers[], suffix: string): Promise<string | undefined> {
  const open = roomTemplates.find((t) => t.id === 'open')!;
  const lead: Role = { id: 'lead', name: 'Project Lead', color: 'orange', permissions: Permission.Administrator, group: false };
  for (const group of room.data.roles.filter((role) => role.group)) {
    const created = await SocketAPI.sendRESTMessage('/rooms', 'POST', {
      name: `${room.data.name} – ${group.name}${suffix ? ` – ${suffix}` : ''}`,
      description: `${group.name} of ${room.data.name}`,
      color: room.data.color,
      ownerId: '',
      isPrivate: true,
      isListed: false,
      roles: [...open.roles, lead],
      bans: [],
    });
    if (!created.success) return created.message;
    const groupMembers = members.filter((m) => m.data.roomId === room._id && m.data.roles.includes(group.id));
    for (const member of groupMembers) {
      const res = await APIHttp.POST<any>('/roommembers/add', { roomId: created.data._id, userId: member.data.userId, roles: ['lead'] });
      if (!res.success) return res.message;
    }
  }
  return undefined;
}
