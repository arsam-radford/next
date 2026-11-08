import { isDeepStrictEqual } from 'util';
import { ALL, EVERYONE, Override, Permission as P } from '@sage3/shared';
import { Board } from '@sage3/shared/types';
import { readRoom, roomPermissionsOf } from '@sage3/backend';
import { BoardsCollection } from './boards';
import { AuditCollection } from './audit';

jest.mock('@sage3/backend', () => ({
  SAGE3Collection: class {
    get = jest.fn();
    updateIf = jest.fn();
  },
  AccessError: class extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
  sageRouter: () => ({ post: jest.fn() }),
  guarded: (handler: unknown) => handler,
  readRoom: jest.fn(),
  roomPermissionsOf: jest.fn(),
  boardPermissionsOf: jest.fn(),
}));
jest.mock('./audit', () => ({ AuditCollection: { record: jest.fn() } }));
jest.mock('./annotations', () => ({ AnnotationsCollection: {} }));
jest.mock('./apps', () => ({ AppsCollection: {} }));
jest.mock('./insight', () => ({ InsightCollection: {} }));

const auth = { id: 'manager', provider: 'google', providerId: 'manager' };
const normal: Override[] = [];
const exam: Override[] = [{ kind: 'role', target: 'student', allow: 0, deny: P.UseAI }];
const room = {
  _id: 'room',
  data: { ownerId: 'owner', roles: [EVERYONE, 'student'].map((id) => ({ id, name: id, color: 'blue', permissions: ALL, group: false })) },
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let boards: Map<string, Board>;
// Exercise the private mutation boundary without making it a public server API.
const collection = BoardsCollection as unknown as {
  changePreset: (actor: typeof auth, id: string, action: string, body: object, presetId?: string) => Promise<Board>;
};
const changePreset = (id: string, action: string, body: object, presetId?: string): Promise<Board> =>
  collection.changePreset(auth, id, action, body, presetId);

beforeEach(() => {
  jest.clearAllMocks();
  boards = new Map(['a', 'b'].map((id) => [id, {
    _id: id, _createdAt: 0, _updatedAt: 0, _createdBy: 'owner', _updatedBy: 'owner',
    data: { name: id, description: 'keep', color: 'blue', roomId: 'room', ownerId: 'owner', overrides: [], code: '', whiteboardLines: ['keep'], executeInfo: { executeFunc: '', params: {} } },
  }]));
  (readRoom as jest.Mock).mockResolvedValue(clone(room));
  (roomPermissionsOf as jest.Mock).mockResolvedValue(ALL);
  (BoardsCollection.get as jest.Mock).mockImplementation(async (id: string) => clone(boards.get(id)));
  (BoardsCollection.updateIf as jest.Mock).mockImplementation(async (id: string, _by: string, changes: object, conditions: Record<string, unknown>) => {
    const board = boards.get(id)!;
    if (!Object.entries(conditions).every(([key, value]) => isDeepStrictEqual(board.data[key as keyof Board['data']], value))) {
      return { conflict: true };
    }
    const doc = { ...board, data: { ...board.data, ...clone(changes) } };
    boards.set(id, doc);
    return { doc };
  });
});

it('saves unapplied snapshots, switches only this board, and audits each preset operation', async () => {
  await changePreset('a', 'save', { name: 'Normal', overrides: normal, before: normal });
  let saved = await changePreset('a', 'save', { name: 'Exam', overrides: exam, before: normal });
  const [normalPreset, examPreset] = saved.data.permissionPresets!;
  expect(saved.data.overrides).toEqual(normal);
  expect(boards.get('b')!.data.permissionPresets).toBeUndefined();
  saved = await changePreset('a', 'apply', { preset: examPreset, before: normal }, examPreset.id);
  expect(saved.data.overrides).toEqual(exam);
  expect(saved.data).toMatchObject({ name: 'a', description: 'keep', whiteboardLines: ['keep'] });
  expect(boards.get('b')!.data.overrides).toEqual(normal);
  await expect(changePreset('b', 'apply', { preset: examPreset, before: normal }, examPreset.id)).rejects.toMatchObject({ status: 409 });
  saved = await changePreset('a', 'apply', { preset: normalPreset, before: exam }, normalPreset.id);
  expect(saved.data.overrides).toEqual(normal);
  await changePreset('a', 'delete', { preset: examPreset }, examPreset.id);
  expect(boards.get('a')!.data.permissionPresets).toEqual([normalPreset]);
  expect((AuditCollection.record as jest.Mock).mock.calls.map((call) => call[2])).toEqual([
    'board.preset.save', 'board.preset.save', 'board.overrides', 'board.preset.apply', 'board.overrides', 'board.preset.apply', 'board.preset.delete',
  ]);
});

it('rechecks current roles and the manager permission bound rather than trusting the saved snapshot', async () => {
  const saved = await changePreset('a', 'save', { name: 'Exam', overrides: exam, before: normal });
  const preset = saved.data.permissionPresets![0];
  (roomPermissionsOf as jest.Mock).mockResolvedValue(P.ManageBoards);
  await expect(changePreset('a', 'apply', { preset, before: normal }, preset.id)).rejects.toThrow('permissions you have');
  (roomPermissionsOf as jest.Mock).mockResolvedValue(0);
  await expect(changePreset('a', 'apply', { preset, before: normal }, preset.id)).rejects.toMatchObject({ status: 403 });
  (roomPermissionsOf as jest.Mock).mockResolvedValue(ALL);
  (readRoom as jest.Mock).mockResolvedValue({ ...room, data: { ...room.data, roles: room.data.roles.slice(0, 1) } });
  await expect(changePreset('a', 'apply', { preset, before: normal }, preset.id)).rejects.toThrow('unknown role');
  expect(boards.get('a')!.data.overrides).toEqual(normal);
});

it('rejects stale overrides, changed or deleted presets, and intervening writes at commit', async () => {
  const saved = await changePreset('a', 'save', { name: 'Exam', overrides: exam, before: normal });
  const preset = saved.data.permissionPresets![0];
  await expect(changePreset('a', 'apply', { preset, before: exam }, preset.id)).rejects.toMatchObject({ status: 409 });
  await expect(changePreset('a', 'apply', { preset: { ...preset, name: 'Changed' }, before: normal }, preset.id)).rejects.toMatchObject({ status: 409 });
  const commit = (BoardsCollection.updateIf as jest.Mock).getMockImplementation()!;
  (BoardsCollection.updateIf as jest.Mock).mockImplementationOnce(async (...args: unknown[]) => {
    boards.get('a')!.data.permissionPresets = [];
    return commit(...args);
  });
  await expect(changePreset('a', 'apply', { preset, before: normal }, preset.id)).rejects.toMatchObject({ status: 409 });
  await expect(changePreset('a', 'apply', { preset, before: normal }, preset.id)).rejects.toMatchObject({ status: 409 });
  boards.get('a')!.data.permissionPresets = [preset];
  (BoardsCollection.updateIf as jest.Mock).mockImplementationOnce(async (...args: unknown[]) => {
    boards.get('a')!.data.overrides = [{ kind: 'role', target: EVERYONE, allow: P.Annotate, deny: 0 }];
    return commit(...args);
  });
  await expect(changePreset('a', 'apply', { preset, before: normal }, preset.id)).rejects.toMatchObject({ status: 409 });
  expect(boards.get('a')!.data.overrides[0].allow).toBe(P.Annotate);
});

it('rejects invalid saves and generic creation or updates that bypass preset checks', async () => {
  await expect(changePreset('a', 'save', { name: ' ', overrides: normal, before: normal })).rejects.toMatchObject({ status: 400 });
  await expect(changePreset('a', 'save', { name: 'Bad', overrides: [{ kind: 'role', target: 'missing', allow: P.Annotate, deny: 0 }], before: normal })).rejects.toThrow('unknown role');
  (roomPermissionsOf as jest.Mock).mockResolvedValue(P.ManageBoards);
  await expect(changePreset('a', 'save', { name: 'Exam', overrides: exam, before: normal })).rejects.toThrow('permissions you have');
  const board = boards.get('a')!;
  await expect(BoardsCollection.access.create(auth, { ...board.data, permissionPresets: [] })).rejects.toThrow('after creating');
  await expect(BoardsCollection.access.update(auth, board, { permissionPresets: [] })).rejects.toThrow('cannot be changed here');
  expect(BoardsCollection.updateIf).not.toHaveBeenCalled();
});
