/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License. The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { accountOf, SAGE3Collection } from '@sage3/backend';
import { SBAuthSchema } from '@sage3/sagebase';
import { EVERYONE, generateReadableID, groupRole, OverridesSchema, Permission as P, RolesSchema, RoomTemplate, roomTemplates } from '@sage3/shared';
import { BoardSchema, inviteId, memberId, RoomSchema } from '@sage3/shared/types';

import { deny } from './access';
import { AuditCollection } from './audit';
import { BoardsCollection } from './boards';
import { InvitesCollection } from './invites';
import { RoomMembersCollection } from './roommembers';

const saveInput = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  includeBoards: z.boolean(),
  joinRoles: z.array(z.string()),
}).strict();
const createInput = z.object({
  templateId: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
  color: z.string(),
  isListed: z.boolean(),
  isPrivate: z.boolean(),
  groups: z.number().int().safe().positive().optional(),
}).strict();
const boardSetup = z.object({ name: z.string(), description: z.string(), color: z.string(), overrides: OverridesSchema });
export type SavedTemplate = RoomTemplate & { ownerId: string; published: boolean; sourceRoomId: string };

function validateSetup(template: RoomTemplate): RoomTemplate {
  const roles = RolesSchema.safeParse(template.roles);
  if (!roles.success) deny('Invalid template roles.', 400);
  const roleIds = new Set(roles.data.map((role) => role.id));
  if (new Set(template.joinRoles).size !== template.joinRoles.length || template.joinRoles.some((id) => id === EVERYONE || !roleIds.has(id))) {
    deny('Join roles must refer to distinct roles in this room, excluding @everyone.', 400);
  }
  const boards = z.array(boardSetup).safeParse(template.boards ?? []);
  if (!boards.success || boards.data.some((board) => board.overrides.some((o) => o.kind !== 'role' || !roleIds.has(o.target)))) {
    deny('Template boards must refer to existing roles only.', 400);
  }
  // Parsed roles/boards are fresh objects and strip all fields outside the setup.
  return { ...template, roles: roles.data, joinRoles: [...template.joinRoles], boards: boards.data };
}

function publicTemplate(template: SavedTemplate): RoomTemplate {
  const { sourceRoomId, ...setup } = template;
  return setup;
}

// No generic HTTP/WS router: clients reach snapshots only through the checked rooms endpoints.
class SAGE3RoomTemplatesCollection extends SAGE3Collection<SavedTemplate> {
  constructor() {
    super('ROOMTEMPLATES', { ownerId: '' });
  }

  public async list(auth: SBAuthSchema): Promise<RoomTemplate[]> {
    const saved = await this.getAll();
    if (!saved) deny('Failed to retrieve templates.', 500);
    return [...roomTemplates, ...saved.filter(({ data }) => data.published || data.ownerId === auth.id || accountOf(auth).instanceAdmin).map((doc) => publicTemplate(doc.data))];
  }

  public async save(auth: SBAuthSchema, rooms: SAGE3Collection<RoomSchema>, roomId: string, body: unknown): Promise<RoomTemplate> {
    const input = saveInput.safeParse(body);
    if (!input.success) deny('Invalid template setup.', 400);
    const room = await rooms.get(roomId);
    if (!room) deny('Room not found.', 404);
    if (room.data.ownerId !== auth.id && !accountOf(auth).instanceAdmin) deny('Only the room owner can save its setup.');
    const boards = input.data.includeBoards ? await BoardsCollection.query('roomId', roomId) : [];
    if (!boards) deny('Failed to retrieve boards.', 500);
    const setup = validateSetup({
      id: randomUUID(),
      name: input.data.name,
      description: input.data.description,
      roles: room.data.roles,
      isPrivate: room.data.isPrivate,
      joinRoles: input.data.joinRoles,
      groups: 0,
      boards: boards.map(({ data }) => ({
        name: data.name, description: data.description, color: data.color,
        overrides: data.overrides.filter((override) => override.kind === 'role'),
      })),
    });
    const data: SavedTemplate = { ...setup, ownerId: auth.id, published: false, sourceRoomId: roomId };
    const saved = await this.add(data, auth.id, data.id);
    if (!saved) deny('Failed to save the template.', 500);
    await AuditCollection.record(auth, room, 'template.save', data.id, `saved ${data.name}`);
    return publicTemplate(saved.data);
  }

  public async publication(auth: SBAuthSchema, rooms: SAGE3Collection<RoomSchema>, id: string, body: unknown): Promise<RoomTemplate> {
    if (!accountOf(auth).instanceAdmin) deny('Only an instance administrator can publish templates.');
    const input = z.object({ published: z.boolean() }).strict().safeParse(body);
    if (!input.success) deny('Invalid publication setting.', 400);
    const saved = await this.saved(id);
    const result = await this.updateIf(id, auth.id, { published: input.data.published }, { published: saved.data.published });
    if (result.conflict) deny('The publication setting changed. Reload templates and try again.', 409);
    if (!result.doc) deny('Failed to change template publication.', 500);
    await this.audit(auth, rooms, saved.data, input.data.published ? 'template.publish' : 'template.unpublish');
    return publicTemplate(result.doc.data);
  }

  public async remove(auth: SBAuthSchema, rooms: SAGE3Collection<RoomSchema>, id: string): Promise<void> {
    const saved = await this.saved(id);
    if (saved.data.ownerId !== auth.id && !accountOf(auth).instanceAdmin) deny('Only the template owner can delete it.');
    if (!(await this.delete(id))) deny('Failed to delete the template.', 500);
    await this.audit(auth, rooms, saved.data, 'template.delete');
  }

  private async saved(id: string) {
    if (roomTemplates.some((template) => template.id === id)) deny('Shipped templates cannot be changed.');
    const saved = await this.get(id);
    if (!saved) deny('Template not found.', 404);
    return saved;
  }

  private async audit(auth: SBAuthSchema, rooms: SAGE3Collection<RoomSchema>, template: SavedTemplate, action: string) {
    const room = await rooms.get(template.sourceRoomId);
    await AuditCollection.record(auth, room ?? { _id: template.sourceRoomId, data: { ownerId: template.ownerId } }, action, template.id, template.name);
  }

  public async createRoom(auth: SBAuthSchema, rooms: SAGE3Collection<RoomSchema>, body: unknown) {
    if (!accountOf(auth).createRooms) deny('You cannot create rooms.');
    const input = createInput.safeParse(body);
    if (!input.success) deny('Invalid room setup.', 400);
    const builtin = roomTemplates.find((template) => template.id === input.data.templateId);
    const saved = builtin ? undefined : await this.get(input.data.templateId);
    if (!builtin && (!saved || !(saved.data.published || saved.data.ownerId === auth.id || accountOf(auth).instanceAdmin))) deny('Template not found.', 404);
    const template = structuredClone(builtin ?? saved!.data);
    if (input.data.groups !== undefined && template.id !== 'group-work') deny('Only the Group work template takes a group count.', 400);
    const count = input.data.groups ?? template.groups;
    const groups = [];
    for (let n = 1; groups.length < count; n++) {
      if (!template.roles.some((role) => role.id === `group-${n}`)) groups.push(groupRole(n));
    }
    template.roles.splice(1, 0, ...groups);
    const boards = [...(template.boards ?? []), ...groups.map((group) => ({
      name: group.name, description: `${group.name}'s board`, color: group.color,
      overrides: [
        { kind: 'role' as const, target: EVERYONE, allow: 0, deny: P.ViewBoard },
        { kind: 'role' as const, target: group.id, allow: P.ViewBoard, deny: 0 },
      ],
    }))];
    const roomId = randomUUID();
    const boardIds: string[] = [];
    let code: string | undefined;
    try {
      // Keep incomplete setup unlisted and invite-only until all dependent writes succeed.
      const data = await rooms.access.create(auth, {
        name: input.data.name, description: input.data.description, color: input.data.color,
        isListed: false, isPrivate: true, ownerId: auth.id, roles: template.roles, bans: [],
      });
      const room = await rooms.add(data, auth.id, roomId);
      if (!room) deny('Failed to create the room.', 500);
      if (!(await RoomMembersCollection.addMember(roomId, auth.id, []))) deny('Failed to join the new room.', 500);
      for (const setup of boards) {
        const id = randomUUID();
        boardIds.push(id);
        const boardData: BoardSchema = { ...setup, roomId, ownerId: auth.id, code: generateReadableID(), executeInfo: { executeFunc: '', params: {} } };
        const checked = await BoardsCollection.access.create(auth, boardData);
        const board = await BoardsCollection.add(checked, auth.id, id);
        if (!board) deny('Failed to create a template board.', 500);
        await BoardsCollection.access.written?.(auth, undefined, board);
      }
      if (input.data.isPrivate || template.joinRoles.length) {
        code = generateReadableID();
        const invite = await InvitesCollection.add({ roomId, code, roles: template.joinRoles, expiresAt: 0, maxUses: 0, uses: 0 }, auth.id, inviteId(roomId, code));
        if (!invite) deny('Failed to create the room invite.', 500);
        await AuditCollection.record(auth, room, 'invite.create', invite._id, `created invite ${code}`);
      }
      const complete = await rooms.update(roomId, auth.id, { isListed: input.data.isListed, isPrivate: input.data.isPrivate });
      if (!complete) deny('Failed to finish the room setup.', 500);
      await AuditCollection.record(auth, complete, 'room.create', roomId, `created from template ${template.name}`);
      return { room: complete, ...(code ? { inviteCode: code } : {}) };
    } catch (error) {
      // IDs are chosen before writes, so even a failed read-after-write can be cleaned up.
      const removed = await rooms.delete(roomId);
      const results = await Promise.allSettled([
        ...boardIds.map((id) => BoardsCollection.deleteBoard(id)),
        RoomMembersCollection.delete(memberId(roomId, auth.id)),
        ...(code ? [InvitesCollection.delete(inviteId(roomId, code))] : []),
      ]);
      if (!removed || results.some((result) => result.status === 'rejected' ||
        (result.status === 'fulfilled' && (!result.value || (typeof result.value === 'object' && !result.value.boardDeleted))))) {
        console.error('Template room rollback could not remove every setup document:', roomId);
      }
      throw error;
    }
  }
}

export const RoomTemplatesCollection = new SAGE3RoomTemplatesCollection();
