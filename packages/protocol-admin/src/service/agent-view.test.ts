import { describe, expect, it } from 'vitest';
import { instanceState, remainingBudget } from '#/service/agent-view';

const NOW = new Date('2026-11-25T12:00:00Z');
const HOUR = 3_600_000;

const base = {
  revokedAt: null,
  expiresAt: new Date(NOW.getTime() + HOUR),
  idleExpiresAt: null,
  sliceMutating: 20,
  sliceCreates: 10,
  spentMutating: 0,
  spentCreates: 0,
};

describe('the state of an agent instance', () => {
  it('is live while nothing has ended it', () => {
    expect(instanceState(base, NOW)).toBe('live');
    expect(instanceState({ ...base, idleExpiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(
      'live',
    );
  });

  it('is expired once its lifetime or its idle time is up, and not before', () => {
    expect(instanceState({ ...base, expiresAt: NOW }, NOW)).toBe('expired');
    expect(instanceState({ ...base, idleExpiresAt: NOW }, NOW)).toBe('expired');
    expect(instanceState({ ...base, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe('live');
  });

  it('is revoked whenever it was revoked, even one that had also lapsed', () => {
    expect(instanceState({ ...base, revokedAt: NOW }, NOW)).toBe('revoked');
    expect(instanceState({ ...base, revokedAt: NOW, expiresAt: new Date(0) }, NOW)).toBe('revoked');
  });
});

describe('what an instance has left of its slice', () => {
  it('is the slice less what was spent, never below none', () => {
    expect(remainingBudget(base)).toEqual({ mutating: 20, creates: 10 });
    expect(remainingBudget({ ...base, spentMutating: 7, spentCreates: 10 })).toEqual({
      mutating: 13,
      creates: 0,
    });
    expect(remainingBudget({ ...base, spentMutating: 25, spentCreates: 12 })).toEqual({
      mutating: 0,
      creates: 0,
    });
  });
});
