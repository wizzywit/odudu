import { expect, it } from 'vitest';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';
import {
  isConversationEnded,
  readOnlyOf,
  switchOutcome,
  unlessEnded,
} from '#/widgets/assistant-panel/services/conversationFlow';

it('returns to the conversation already open, opens another when nothing runs, and asks while one does', () => {
  expect(switchOutcome(false, 'a', 'a')).toBe('stay');
  expect(switchOutcome(true, 'a', 'a')).toBe('stay');
  expect(switchOutcome(false, 'a', 'b')).toBe('open');
  expect(switchOutcome(true, 'a', 'b')).toBe('ask-to-stop');
  expect(switchOutcome(false, 'a', null)).toBe('open');
  expect(switchOutcome(true, 'a', null)).toBe('ask-to-stop');
  expect(switchOutcome(false, null, null)).toBe('open');
});

it('is read-only when hidden, or when its sign-in ended, and hidden is said first', () => {
  expect(readOnlyOf({ archived: false, continuable: true })).toBeNull();
  expect(readOnlyOf({ archived: true, continuable: true })).toBe('archived');
  expect(readOnlyOf({ archived: false, continuable: false })).toBe('ended');
  expect(readOnlyOf({ archived: true, continuable: false })).toBe('archived');
});

it('draws a refused message as never sent, and a chat that settled, when the sign-in ended', () => {
  const snapshot = {
    chat: 'error' as const,
    messages: ['earlier', 'refused'],
    error: new Error('x'),
    expectsEnd: true,
  };
  expect(unlessEnded(false, snapshot)).toBe(snapshot);
  expect(unlessEnded(true, snapshot)).toEqual({
    chat: 'ready',
    messages: ['earlier'],
    error: undefined,
    expectsEnd: false,
  });
});

it('knows the refusal of a message to a conversation that ended, and no other', () => {
  const problem = (type: string) =>
    new ChatCallError({
      ok: false,
      kind: 'problem',
      problem: { type, title: 'Conflict', status: 409 },
    });
  expect(isConversationEnded(problem('about:blank#conversation-ended'))).toBe(true);
  expect(isConversationEnded(problem('about:blank'))).toBe(false);
  expect(isConversationEnded(new ChatCallError({ ok: false, kind: 'network' }))).toBe(false);
  expect(isConversationEnded(new Error('x'))).toBe(false);
  expect(isConversationEnded(undefined)).toBe(false);
});
