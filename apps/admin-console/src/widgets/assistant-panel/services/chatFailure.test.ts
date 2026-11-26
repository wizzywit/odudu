import { describe, expect, it } from 'vitest';
import { failureOf, GENERIC_FAILURE } from '#/widgets/assistant-panel/services/chatFailure';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';

function refused(status: number, instance?: string) {
  return new ChatCallError({
    ok: false,
    kind: 'problem',
    problem: {
      type: 'about:blank',
      title: 'x',
      status,
      ...(instance === undefined ? {} : { instance }),
    },
  });
}

describe('what a failed call is told to the person', () => {
  it.each([
    [404, 'This conversation is no longer available. Start a new one.'],
    [409, 'Another answer is still running in this conversation. Wait for it, or stop it.'],
    [429, 'The assistant is busy right now. Try again in a moment.'],
    [403, 'You do not have permission to use the assistant here.'],
    [500, 'The console could not reach the assistant. Try again.'],
    [502, 'The console could not reach the assistant. Try again.'],
  ])('words a %i in plain terms', (status, cause) => {
    expect(failureOf(refused(status)).cause).toBe(cause);
  });

  it('says the assistant is not available where a conversation cannot be started and the path is not served', () => {
    const refusal = new ChatCallError(
      {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Not Found', status: 404 },
      },
      'start',
    );
    expect(failureOf(refusal).cause).toContain('not available here');
    expect(failureOf(refused(404)).cause).toContain('no longer available');
  });

  it('carries the request’s own reference when there is one, and nothing else', () => {
    expect(failureOf(refused(500, '01a0e77f'))).toEqual({
      cause: 'The console could not reach the assistant. Try again.',
      trace: '01a0e77f',
    });
    expect(failureOf(refused(500)).trace).toBeNull();
  });

  it('words a network failure and a malformed answer as the console not reaching the assistant', () => {
    const network = new ChatCallError({ ok: false, kind: 'network' });
    expect(failureOf(network).cause).toBe('The console could not reach the assistant. Try again.');
    expect(failureOf(new ChatCallError({ ok: false, kind: 'schema' })).cause).toBe(
      'The console could not reach the assistant. Try again.',
    );
  });

  it('words a dropped connection the same way', () => {
    expect(failureOf(new TypeError('Failed to fetch')).cause).toBe(
      'The console could not reach the assistant. Try again.',
    );
  });

  it('shows the text a stream’s error part carried, trimmed, and never a stack', () => {
    const error = new Error(`  ${GENERIC_FAILURE}  `);
    error.stack = 'Error: leaked\n    at secret (file.ts:1:1)';
    const failure = failureOf(error);
    expect(failure).toEqual({ cause: GENERIC_FAILURE, trace: null });
    expect(JSON.stringify(failure)).not.toContain('secret');
  });

  it('shortens an error that is not a sentence for a person, and keeps the generic one for none', () => {
    expect(failureOf(new Error('')).cause).toBe(GENERIC_FAILURE);
    expect(failureOf('boom').cause).toBe(GENERIC_FAILURE);
    expect(failureOf(new Error('x'.repeat(1000))).cause).toBe(GENERIC_FAILURE);
  });
});
