import { describe, expect, it } from 'vitest';
import { isLockedOut, nextLockout } from '#/service/lockout';

const policy = {
  maxFailures: 3,
  lockoutSeconds: 60,
  maxLockoutSeconds: 240,
  failureResetSeconds: 3600,
};
const now = new Date('2026-09-15T12:00:00Z');

describe('nextLockout', () => {
  it('counts up without locking below the threshold', () => {
    expect(nextLockout({ failureCount: 1, lastFailureAt: now }, policy, now)).toEqual({
      failureCount: 2,
      lockedUntil: null,
    });
  });

  it('locks for the base duration at the threshold', () => {
    const result = nextLockout({ failureCount: 2, lastFailureAt: now }, policy, now);
    expect(result.failureCount).toBe(3);
    expect(result.lockedUntil).toEqual(new Date('2026-09-15T12:01:00Z'));
  });

  it('doubles each further failure', () => {
    expect(nextLockout({ failureCount: 3, lastFailureAt: now }, policy, now).lockedUntil).toEqual(
      new Date('2026-09-15T12:02:00Z'),
    );
    expect(nextLockout({ failureCount: 4, lastFailureAt: now }, policy, now).lockedUntil).toEqual(
      new Date('2026-09-15T12:04:00Z'),
    );
  });

  it('stops doubling at the ceiling', () => {
    expect(nextLockout({ failureCount: 9, lastFailureAt: now }, policy, now).lockedUntil).toEqual(
      new Date('2026-09-15T12:04:00Z'),
    );
  });

  it('starts again from one after a quiet period', () => {
    const old = new Date('2026-09-15T10:00:00Z');
    expect(nextLockout({ failureCount: 7, lastFailureAt: old }, policy, now)).toEqual({
      failureCount: 1,
      lockedUntil: null,
    });
  });

  // The state a subject with no row is judged from: the first failure is
  // the first failure whether a quiet period preceded it or nothing did.
  it('counts a subject with no failures on record as their first', () => {
    expect(nextLockout({ failureCount: 0, lastFailureAt: null }, policy, now)).toEqual({
      failureCount: 1,
      lockedUntil: null,
    });
  });

  it('treats a run whose quiet period has exactly elapsed as broken', () => {
    const anHourAgo = new Date('2026-09-15T11:00:00Z');
    expect(
      nextLockout({ failureCount: 5, lastFailureAt: anHourAgo }, policy, now).failureCount,
    ).toBe(1);
  });
});

describe('isLockedOut', () => {
  it('reads a subject with no lockout recorded as not locked', () => {
    expect(isLockedOut({ lockedUntil: null }, now)).toBe(false);
  });

  it('reads a lockout that has not expired as locked', () => {
    expect(isLockedOut({ lockedUntil: new Date('2026-09-15T12:00:01Z') }, now)).toBe(true);
  });

  // The boundary is exclusive, the way every other expiry in this codebase
  // is: the instant the lockout names is the instant it stops applying.
  it('reads a lockout that has just expired as not locked', () => {
    expect(isLockedOut({ lockedUntil: now }, now)).toBe(false);
  });
});
