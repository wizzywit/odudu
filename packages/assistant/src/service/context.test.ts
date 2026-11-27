import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { boundHistory, HISTORY_MESSAGES } from '#/service/context';

function message(id: string, role: UIMessage['role']): UIMessage {
  return { id, role, parts: [{ type: 'text', text: id }] };
}

function alternating(count: number): UIMessage[] {
  return Array.from({ length: count }, (_, i) =>
    message(String(i), i % 2 === 0 ? 'user' : 'assistant'),
  );
}

describe('boundHistory', () => {
  it('returns a short history whole', () => {
    const all = alternating(3);
    expect(boundHistory(all)).toEqual(all);
  });

  it('keeps only the latest messages of a long one', () => {
    const all = alternating(HISTORY_MESSAGES + 10);
    const kept = boundHistory(all);
    expect(kept.length).toBeLessThanOrEqual(HISTORY_MESSAGES);
    expect(kept.at(-1)).toBe(all.at(-1));
  });

  it('never starts on a reply whose question was cut away', () => {
    expect(boundHistory(alternating(HISTORY_MESSAGES + 3))[0]?.role).toBe('user');
  });

  it('does not change what it is given', () => {
    const all = alternating(HISTORY_MESSAGES + 4);
    boundHistory(all);
    expect(all).toHaveLength(HISTORY_MESSAGES + 4);
  });
});
