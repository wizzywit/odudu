import { expect, it } from 'vitest';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';
import { startedId } from '#/widgets/assistant-panel/services/conversationStart';

it('hands over the id of a conversation that was started', () => {
  expect(startedId({ ok: true, status: 201, data: { id: 'c1' }, etag: null, next: null })).toBe(
    'c1',
  );
});

it('throws a refusal as the error the panel words, marked as a start', () => {
  const refusal = { ok: false, kind: 'network' } as const;
  expect(() => startedId(refusal)).toThrow(ChatCallError);
  try {
    startedId(refusal);
  } catch (error) {
    expect(error).toMatchObject({ during: 'start', failure: refusal });
  }
});
