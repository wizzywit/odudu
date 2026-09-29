import { describe, expect, it } from 'vitest';
import { accessNeedsRefresh, sessionHasEnded, sessionNeedsTouch } from '#/service/session-lifetime';

const SIGNED_IN = new Date('2026-06-01T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function at(ms: number): Date {
  return new Date(SIGNED_IN.getTime() + ms);
}

const session = { lastSeenAt: SIGNED_IN, expiresAt: at(12 * 60 * MINUTE) };

describe('sessionHasEnded', () => {
  it('holds a session through thirty minutes idle and ends it a second later', () => {
    expect(sessionHasEnded(session, at(30 * MINUTE))).toBe(false);
    expect(sessionHasEnded(session, at(30 * MINUTE + SECOND))).toBe(true);
  });

  it('measures idleness from the last time the session was seen', () => {
    const seen = { ...session, lastSeenAt: at(60 * MINUTE) };
    expect(sessionHasEnded(seen, at(89 * MINUTE))).toBe(false);
    expect(sessionHasEnded(seen, at(90 * MINUTE + SECOND))).toBe(true);
  });

  it('ends a session at its absolute expiry however recently it was seen', () => {
    const active = { ...session, lastSeenAt: at(12 * 60 * MINUTE - MINUTE) };
    expect(sessionHasEnded(active, at(12 * 60 * MINUTE - SECOND))).toBe(false);
    expect(sessionHasEnded(active, at(12 * 60 * MINUTE))).toBe(true);
  });
});

describe('sessionNeedsTouch', () => {
  it('writes last_seen_at at most once a minute', () => {
    expect(sessionNeedsTouch(session, at(59 * SECOND))).toBe(false);
    expect(sessionNeedsTouch(session, at(MINUTE))).toBe(true);
  });
});

describe('accessNeedsRefresh', () => {
  const expiry = { accessExpiresAt: at(5 * MINUTE) };

  it('keeps an access token with more than thirty seconds left', () => {
    expect(accessNeedsRefresh(expiry, at(5 * MINUTE - 31 * SECOND))).toBe(false);
  });

  it('refreshes one within thirty seconds of expiry, and one already expired', () => {
    expect(accessNeedsRefresh(expiry, at(5 * MINUTE - 30 * SECOND))).toBe(true);
    expect(accessNeedsRefresh(expiry, at(5 * MINUTE - 10 * SECOND))).toBe(true);
    expect(accessNeedsRefresh(expiry, at(6 * MINUTE))).toBe(true);
  });
});
