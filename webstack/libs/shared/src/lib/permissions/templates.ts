/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Room setups are copied when creating a room, never linked to it afterward.

import { APP_PERMISSIONS, BOARD_PERMISSIONS, EVERYONE, Override, Permission as P, Role } from './permissions';

export type RoomTemplate = {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  // Joining needs an invite
  isPrivate: boolean;
  // Roles a new room's first invite grants
  joinRoles: string[];
  // Number of group roles (and group boards) to create with the room
  groups: number;
  // Empty boards and role overrides only; never content or personal overrides.
  boards?: { name: string; description: string; color: string; overrides: Override[] }[];
  // Present on saved templates; shipped templates have neither.
  ownerId?: string;
  published?: boolean;
};

// Simple levels the role editor offers before its advanced grid. Each sets the bits of one area.
export type Level = { name: string; bits: number };

export const appLevels: Level[] = [
  { name: 'View only', bits: 0 },
  { name: 'Interact', bits: P.InteractWithApps },
  { name: 'Own apps', bits: P.CreateApps | P.InteractWithApps | P.EditOwnApps | P.ArrangeOwnApps | P.DeleteOwnApps },
  {
    name: 'Collaborate',
    bits: P.CreateApps | P.InteractWithApps | P.EditOwnApps | P.ArrangeOwnApps | P.DeleteOwnApps | P.EditOthersApps | P.ArrangeOthersApps,
  },
  { name: 'Full', bits: APP_PERMISSIONS | P.CreateApps },
];

export const fileLevels: Level[] = [
  { name: 'None', bits: 0 },
  { name: 'Submit only', bits: P.UploadAssets },
  { name: 'View', bits: P.BrowseOthersAssets | P.DownloadOthersAssets },
  { name: 'Upload and view', bits: P.UploadAssets | P.BrowseOthersAssets | P.DownloadOthersAssets },
  { name: 'Full', bits: P.UploadAssets | P.BrowseOthersAssets | P.DownloadOthersAssets | P.ManageOthersAssets },
];

export const pluginLevels: Level[] = [
  { name: 'None', bits: 0 },
  { name: 'Use', bits: P.UsePlugins },
  { name: 'Use and place', bits: P.UsePlugins | P.PlacePlugins },
  { name: 'Full', bits: P.UsePlugins | P.PlacePlugins | P.UploadPlugins },
];

const level = (levels: Level[], name: string) => levels.find((l) => l.name === name)!.bits;

const viewer = P.ViewBoard | P.ViewPresence | level(fileLevels, 'View');
const student =
  viewer | P.Annotate | P.Chat | level(appLevels, 'Collaborate') | level(fileLevels, 'Upload and view') | level(pluginLevels, 'Use and place');
const ta =
  student |
  level(appLevels, 'Full') |
  level(fileLevels, 'Full') |
  level(pluginLevels, 'Full') |
  P.ManageBoards |
  P.ManageMembers |
  P.ModerateMembers |
  P.Present |
  P.ViewAuditLog |
  P.UseAI |
  P.ExecuteCode |
  P.Screenshare;

function role(id: string, name: string, color: string, permissions: number): Role {
  return { id, name, color, permissions, group: false };
}

function classroom(studentPermissions: number): Role[] {
  return [
    role(EVERYONE, '@everyone', 'gray', viewer),
    role('student', 'Student', 'teal', studentPermissions),
    role('ta', 'TA', 'orange', ta),
    role('instructor', 'Instructor', 'red', P.Administrator),
  ];
}

export function groupRole(n: number): Role {
  return { id: `group-${n}`, name: `Group ${n}`, color: 'purple', permissions: 0, group: true };
}

export const roomTemplates: RoomTemplate[] = [
  {
    id: 'classroom',
    name: 'Classroom',
    description: 'Instructor, TA and Student roles. Members join with an invite as Students.',
    roles: classroom(student),
    isPrivate: true,
    joinRoles: ['student'],
    groups: 0,
  },
  {
    id: 'group-work',
    name: 'Group work',
    description: 'Classroom, plus group roles with one private board per group.',
    roles: classroom(student),
    isPrivate: true,
    joinRoles: ['student'],
    groups: 4,
  },
  {
    id: 'lecture',
    name: 'Lecture',
    description: 'Students can vote, chat, annotate and use plugins, but not change the slides.',
    roles: classroom(viewer | P.InteractWithApps | P.Annotate | P.Chat | P.UsePlugins),
    isPrivate: true,
    joinRoles: ['student'],
    groups: 0,
  },
  {
    id: 'open',
    name: 'Open collaboration',
    description: 'Everyone in the room can do everything except manage the room.',
    roles: [role(EVERYONE, '@everyone', 'gray', BOARD_PERMISSIONS | P.ManageBoards | P.UploadPlugins)],
    isPrivate: false,
    joinRoles: [],
    groups: 0,
  },
];

export const openRoomRoles = roomTemplates[3].roles;
