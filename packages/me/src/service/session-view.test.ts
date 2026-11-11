import { describe, expect, it } from 'vitest';
import { sessionView } from '#/service/session-view';

const AT = new Date('2026-01-01T00:00:00Z');
const record = { id: 's1', createdAt: AT, lastActiveAt: AT, expiresAt: AT, remembered: false };

describe('sessionView', () => {
  it('marks the session the token was issued for', () => {
    expect(sessionView(record, 's1').current).toBe(true);
    expect(sessionView(record, 's2').current).toBe(false);
  });

  it('marks none when the token has no session', () => {
    expect(sessionView(record, null).current).toBe(false);
  });

  it('has no device yet', () => {
    expect(sessionView(record, null).device).toBeNull();
  });
});
