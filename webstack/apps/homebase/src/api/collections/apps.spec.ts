import { appActions } from '@sage3/applications/actions';

const chatActions = appActions.Chat!;

const message = (id: string, userId: string) => ({ id, userId, userName: userId, creationId: '', creationDate: 0, query: 'hi', response: '' });
const state = { messages: [message('1', 'alice')], previousQ: ['q1'], previousA: ['a1'], context: '', token: '', sources: [], firstQuestion: '' };

describe('Chat post action', () => {
  it("adds messages after what is there, under the poster's own id", () => {
    const after = chatActions.post(state, { messages: [message('2', 'alice')] }, 'bob');
    expect(after.messages).toEqual([message('1', 'alice'), { ...message('2', 'alice'), userId: 'bob' }]);
    expect(after.previousQ).toEqual(['q1']);
  });
  it('appends the AI history that goes with an answer', () => {
    const after = chatActions.post(state, { messages: [message('2', 'bob')], previousQ: ['q2'], previousA: ['a2'] }, 'bob');
    expect(after.previousQ).toEqual(['q1', 'q2']);
    expect(after.previousA).toEqual(['a1', 'a2']);
  });
  it('refuses malformed messages', () => {
    expect(() => chatActions.post(state, { messages: [{ id: '2' }] }, 'bob')).toThrow();
    expect(() => chatActions.post(state, {}, 'bob')).toThrow();
  });
});
