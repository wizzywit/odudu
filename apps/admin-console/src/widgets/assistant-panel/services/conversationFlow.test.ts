import { expect, it } from 'vitest';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';
import {
  readOnlyOf,
  refusedEndOf,
  unsentTextOf,
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

it('is read-only when hidden, or when its sign-in was ended for another reason, and hidden is said first', () => {
  const ok = { archived: false, continuable: true };
  expect(readOnlyOf({})).toBeNull();
  expect(readOnlyOf({ server: ok })).toBeNull();
  expect(readOnlyOf({ server: { archived: true, continuable: true } })).toBe('archived');
  expect(readOnlyOf({ server: { archived: false, continuable: false } })).toBe('ended');
  expect(readOnlyOf({ server: { archived: true, continuable: false } })).toBe('archived');
});

it('lets what the person did here, and a refusal, outrank what the server last said', () => {
  const hidden = { archived: true, continuable: true };
  expect(readOnlyOf({ archivedHere: false, server: hidden })).toBeNull();
  expect(readOnlyOf({ archivedHere: true, server: { archived: false, continuable: true } })).toBe(
    'archived',
  );
  expect(
    readOnlyOf({ server: { archived: false, continuable: true }, refusedEnd: 'revoked' }),
  ).toBe('ended');
  expect(readOnlyOf({ refusedEnd: 'archived' })).toBe('archived');
});

it('draws a refused message as never sent, and a chat that settled, when the conversation cannot be carried on', () => {
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

it('tells a refusal that ends the conversation from a hidden one, and from any other', () => {
  const problem = (type: string) =>
    new ChatCallError({
      ok: false,
      kind: 'problem',
      problem: { type, title: 'Conflict', status: 409 },
    });
  expect(refusedEndOf(problem('about:blank#conversation-ended'))).toBe('revoked');
  expect(refusedEndOf(problem('about:blank#conversation-archived'))).toBe('archived');
  expect(refusedEndOf(problem('about:blank#conversation-access-refused'))).toBeNull();
  expect(refusedEndOf(problem('about:blank'))).toBeNull();
  expect(refusedEndOf(new ChatCallError({ ok: false, kind: 'network' }))).toBeNull();
  expect(refusedEndOf(new Error('x'))).toBeNull();
  expect(refusedEndOf(undefined)).toBeNull();
});

it('reads back the text of a refused message, and nothing when the last message is not the person’s', () => {
  const user = {
    role: 'user',
    parts: [{ type: 'text', text: 'one' }, { type: 'file' }, { type: 'text', text: 'two' }],
  };
  expect(unsentTextOf([user], true)).toBe('one\ntwo');
  expect(
    unsentTextOf([user, { role: 'assistant', parts: [{ type: 'text', text: 'x' }] }], true),
  ).toBeNull();
  expect(unsentTextOf([{ role: 'user', parts: [] }], true)).toBeNull();
  expect(unsentTextOf([], true)).toBeNull();
  expect(unsentTextOf([user], false)).toBeNull();
});
