import { SAGE3Collection } from '@sage3/backend';
import { SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { EVERYONE, Permission as P, roomTemplates } from '@sage3/shared';
import { BoardSchema, InviteSchema, RoomSchema } from '@sage3/shared/types';
import { AuditCollection } from './audit';
import { BoardsCollection } from './boards';
import { InvitesCollection } from './invites';
import { RoomMembersCollection } from './roommembers';
import { RoomTemplatesCollection, SavedTemplate } from './roomtemplates';

jest.mock('./audit', () => ({ AuditCollection: { record: jest.fn() } }));
jest.mock('./boards', () => ({ BoardsCollection: { query: jest.fn(), add: jest.fn(), deleteBoard: jest.fn(), access: { create: jest.fn(), written: jest.fn() } } }));
jest.mock('./invites', () => ({ InvitesCollection: { add: jest.fn(), delete: jest.fn() } }));
jest.mock('./roommembers', () => ({ RoomMembersCollection: { addMember: jest.fn(), delete: jest.fn() } }));

const owner = { id: 'owner', provider: 'google' } as SBAuthSchema;
const other = { id: 'other', provider: 'google' } as SBAuthSchema;
const admin = { id: 'admin', provider: 'admin' } as SBAuthSchema;
const rooms = new SAGE3Collection<RoomSchema>('TEST_ROOMS', {});
const source: SBDocument<RoomSchema> = {
  _id: 'source', _createdAt: 0, _updatedAt: 0, _createdBy: owner.id, _updatedBy: owner.id,
  data: {
    name: 'Source', description: '', color: 'red', isListed: true, isPrivate: true, ownerId: owner.id,
    roles: [
      { id: EVERYONE, name: '@everyone', color: 'gray', permissions: P.ViewBoard, group: false },
      { id: 'custom-group', name: 'Lab partners', color: 'pink', permissions: P.Annotate, group: true },
      { id: 'custom-lead', name: 'Facilitator', color: 'blue', permissions: P.Administrator, group: false },
    ],
    bans: ['banned-person'],
  },
};
const saveBody = { name: 'My setup', description: 'Private setup', includeBoards: true, joinRoles: ['custom-group'] };
const createBody = { name: 'Copy', description: '', color: 'teal', isListed: true, isPrivate: true };

// In-memory persistence isolates setup semantics; actual account checks and input schemas run unchanged.
describe('saved room templates', () => {
  let saved: Map<string, SBDocument<SavedTemplate>>;
  let createdRooms: Map<string, SBDocument<RoomSchema>>;
  let createdBoards: Map<string, SBDocument<BoardSchema>>;
  let invites: Map<string, SBDocument<InviteSchema>>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    saved = new Map();
    createdRooms = new Map();
    createdBoards = new Map();
    invites = new Map();
    jest.spyOn(rooms, 'get').mockImplementation(async (id) => id === source._id ? structuredClone(source) : createdRooms.get(id));
    rooms.access.create = async (_auth, data) => data;
    jest.spyOn(rooms, 'add').mockImplementation(async (data, by, id) => {
      const doc = { _id: id!, _createdAt: 0, _updatedAt: 0, _createdBy: by, _updatedBy: by, data: structuredClone(data) };
      createdRooms.set(id!, doc);
      return doc;
    });
    jest.spyOn(rooms, 'update').mockImplementation(async (id, _by, data) => {
      const doc = createdRooms.get(id)!;
      Object.assign(doc.data, data);
      return doc;
    });
    jest.spyOn(rooms, 'delete').mockImplementation(async (id) => createdRooms.delete(id) ? id : undefined);
    jest.spyOn(RoomTemplatesCollection, 'getAll').mockImplementation(async () => [...saved.values()]);
    jest.spyOn(RoomTemplatesCollection, 'get').mockImplementation(async (id) => saved.get(id));
    jest.spyOn(RoomTemplatesCollection, 'add').mockImplementation(async (data, _by, id) => {
      const doc = { ...source, _id: id!, data: structuredClone(data) };
      saved.set(id!, doc);
      return doc;
    });
    jest.spyOn(RoomTemplatesCollection, 'updateIf').mockImplementation(async (id, _by, changes) => {
      const doc = saved.get(id)!;
      Object.assign(doc.data, changes);
      return { success: true, conflict: false, writetime: 0, doc };
    });
    jest.spyOn(RoomTemplatesCollection, 'delete').mockImplementation(async (id) => saved.delete(id) ? id : undefined);
    jest.mocked(BoardsCollection.query).mockResolvedValue([{ ...source, _id: 'source-board', data: {
      name: 'Lab', description: 'Shared', color: 'purple', roomId: source._id, ownerId: owner.id,
      code: 'secret-code', whiteboardLines: ['private drawing'], executeInfo: { executeFunc: 'secret', params: {} },
      overrides: [
        { kind: 'role', target: 'custom-group', allow: P.ViewBoard, deny: 0 },
        { kind: 'member', target: 'private-person', allow: 0, deny: P.Annotate },
      ],
    } }]);
    jest.mocked(BoardsCollection.access.create).mockImplementation(async (_auth, data) => data);
    jest.mocked(BoardsCollection.add).mockImplementation(async (data, _by, id) => {
      const doc = { ...source, _id: id!, data: structuredClone(data) };
      createdBoards.set(id!, doc);
      return doc;
    });
    jest.mocked(BoardsCollection.deleteBoard).mockImplementation(async (id) => ({ boardId: id, boardDeleted: createdBoards.delete(id), appsDeleted: 0, annotationsDeleted: false, insightsDeleted: 0 }));
    jest.mocked(RoomMembersCollection.addMember).mockResolvedValue({ ...source, _id: 'owner-membership', data: { roomId: source._id, userId: owner.id, roles: [], timeoutUntil: 0 } });
    jest.mocked(RoomMembersCollection.delete).mockImplementation(async (id) => id);
    jest.mocked(InvitesCollection.add).mockImplementation(async (data, _by, id) => {
      const doc = { ...source, _id: id!, data: structuredClone(data) };
      invites.set(id!, doc);
      return doc;
    });
    jest.mocked(InvitesCollection.delete).mockImplementation(async (id) => invites.delete(id) ? id : undefined);
  });

  it('copies custom roles and empty board role overrides, never personal data, and remains independent after deletion', async () => {
    const template = await RoomTemplatesCollection.save(owner, rooms, source._id, saveBody);
    expect(template.roles).toEqual(source.data.roles);
    expect(template).not.toHaveProperty('sourceRoomId');
    expect(template.boards).toEqual([{
      name: 'Lab', description: 'Shared', color: 'purple',
      overrides: [{ kind: 'role', target: 'custom-group', allow: P.ViewBoard, deny: 0 }],
    }]);
    expect(JSON.stringify(template)).not.toMatch(/private-person|banned-person|secret-code|private drawing/);
    const created = await RoomTemplatesCollection.createRoom(owner, rooms, { ...createBody, templateId: template.id });
    expect(created.room.data.roles).toEqual(source.data.roles);
    expect(created.room.data.bans).toEqual([]);
    expect(RoomMembersCollection.addMember).toHaveBeenCalledWith(created.room._id, owner.id, []);
    expect([...createdBoards.values()][0].data).toMatchObject({ roomId: created.room._id, ownerId: owner.id, executeInfo: { executeFunc: '', params: {} } });
    expect([...invites.values()][0].data.roles).toEqual(['custom-group']);
    saved.get(template.id)!.data.roles[1].name = 'Changed template';
    await RoomTemplatesCollection.remove(owner, rooms, template.id);
    expect(created.room.data.roles[1].name).toBe('Lab partners');
    expect(createdBoards.size).toBe(1);
    expect(AuditCollection.record).toHaveBeenCalledWith(owner, expect.anything(), 'template.save', template.id, expect.any(String));
  });

  it('enforces ownership, publication, visibility and Create Rooms against direct calls', async () => {
    await expect(RoomTemplatesCollection.save(other, rooms, source._id, saveBody)).rejects.toMatchObject({ status: 403 });
    const template = await RoomTemplatesCollection.save(owner, rooms, source._id, saveBody);
    expect((await RoomTemplatesCollection.list(other)).map((t) => t.id)).not.toContain(template.id);
    expect((await RoomTemplatesCollection.list(admin)).map((t) => t.id)).toContain(template.id);
    await expect(RoomTemplatesCollection.createRoom(other, rooms, { ...createBody, templateId: template.id })).rejects.toMatchObject({ status: 404 });
    await expect(RoomTemplatesCollection.publication(owner, rooms, template.id, { published: true })).rejects.toMatchObject({ status: 403 });
    await expect(RoomTemplatesCollection.remove(other, rooms, template.id)).rejects.toMatchObject({ status: 403 });
    await RoomTemplatesCollection.publication(admin, rooms, template.id, { published: true });
    expect((await RoomTemplatesCollection.list(other)).map((t) => t.id)).toContain(template.id);
    const copy = await RoomTemplatesCollection.createRoom(other, rooms, { ...createBody, templateId: template.id });
    expect(copy.room.data.ownerId).toBe(other.id);
    await RoomTemplatesCollection.publication(admin, rooms, template.id, { published: false });
    await expect(RoomTemplatesCollection.createRoom(other, rooms, { ...createBody, templateId: template.id })).rejects.toMatchObject({ status: 404 });
    expect(createdRooms.has(copy.room._id)).toBe(true);
    await expect(RoomTemplatesCollection.createRoom({ id: 'guest', provider: 'guest' } as SBAuthSchema, rooms, { ...createBody, templateId: 'open' })).rejects.toMatchObject({ status: 403 });
    await expect(RoomTemplatesCollection.remove(admin, rooms, 'classroom')).rejects.toMatchObject({ status: 403 });
    await expect(RoomTemplatesCollection.publication(admin, rooms, 'classroom', { published: true })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects invalid role references and untrusted setup fields', async () => {
    for (const joinRoles of [['missing'], [EVERYONE], ['custom-group', 'custom-group']]) {
      await expect(RoomTemplatesCollection.save(owner, rooms, source._id, { ...saveBody, joinRoles })).rejects.toMatchObject({ status: 400 });
    }
    await expect(RoomTemplatesCollection.save(owner, rooms, source._id, { ...saveBody, published: true })).rejects.toMatchObject({ status: 400 });
    jest.mocked(BoardsCollection.query).mockResolvedValue([{ ...source, data: {
      name: '', description: '', color: '', roomId: source._id, ownerId: owner.id, code: '', executeInfo: { executeFunc: '', params: {} },
      overrides: [{ kind: 'role', target: 'deleted-role', allow: P.ViewBoard, deny: 0 }],
    } }]);
    await expect(RoomTemplatesCollection.save(owner, rooms, source._id, saveBody)).rejects.toMatchObject({ status: 400 });
    const withoutBoards = await RoomTemplatesCollection.save(owner, rooms, source._id, { ...saveBody, includeBoards: false });
    expect(withoutBoards.boards).toEqual([]);
    await expect(RoomTemplatesCollection.createRoom(owner, rooms, { ...createBody, templateId: withoutBoards.id, groups: 2 })).rejects.toMatchObject({ status: 400 });
  });

  it('creates configurable group boards without changing the shipped template and rejects stale publication writes', async () => {
    const before = structuredClone(roomTemplates);
    const copy = await RoomTemplatesCollection.createRoom(owner, rooms, { ...createBody, templateId: 'group-work', groups: 2 });
    expect(copy.room.data.roles.filter((role) => role.group)).toHaveLength(2);
    expect([...createdBoards.values()].map(({ data }) => data.overrides)).toEqual([1, 2].map((n) => [
      { kind: 'role', target: EVERYONE, allow: 0, deny: P.ViewBoard },
      { kind: 'role', target: `group-${n}`, allow: P.ViewBoard, deny: 0 },
    ]));
    expect(roomTemplates).toEqual(before);
    const template = await RoomTemplatesCollection.save(owner, rooms, source._id, saveBody);
    jest.mocked(RoomTemplatesCollection.updateIf).mockResolvedValueOnce({ success: false, conflict: true, writetime: 0, doc: undefined });
    await expect(RoomTemplatesCollection.publication(admin, rooms, template.id, { published: true })).rejects.toMatchObject({ status: 409 });
  });


  it('creates an invite for a private saved setup even when it grants no additional roles', async () => {
    const template = await RoomTemplatesCollection.save(owner, rooms, source._id, { ...saveBody, joinRoles: [] });
    const copy = await RoomTemplatesCollection.createRoom(owner, rooms, { ...createBody, templateId: template.id });
    expect(copy.inviteCode).toBeDefined();
    expect([...invites.values()][0].data.roles).toEqual([]);
  });

  it.each(['board', 'invite'])('rolls back room, boards, membership and any invite when %s persistence fails', async (failure) => {
    if (failure === 'board') jest.mocked(BoardsCollection.add).mockResolvedValueOnce(undefined);
    else jest.mocked(InvitesCollection.add).mockImplementationOnce(async (data, _by, id) => {
      // Simulate a write succeeding but its read-back failing.
      invites.set(id!, { ...source, _id: id!, data });
      return undefined;
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(RoomTemplatesCollection.createRoom(owner, rooms, { ...createBody, templateId: 'group-work', groups: 2 })).rejects.toMatchObject({ status: 500 });
    expect(createdRooms.size).toBe(0);
    expect(createdBoards.size).toBe(0);
    expect(invites.size).toBe(0);
    expect(RoomMembersCollection.delete).toHaveBeenCalled();
  });
});
