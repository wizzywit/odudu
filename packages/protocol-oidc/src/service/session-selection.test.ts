import { describe, expect, it } from 'vitest';
import { mostRecentlyActive } from '#/service/session-selection';
import { type SessionRecord } from '@odudu/authn-flows';

function session(id: string, lastActiveAt: Date): SessionRecord {
  return {
    id,
    tenantId: 'tenant-1',
    subjectId: 'subject-1',
    createdAt: lastActiveAt,
    expiresAt: new Date('2100-01-01'),
    lastActiveAt,
    authenticators: ['password'],
    remembered: false,
  };
}

describe('mostRecentlyActive', () => {
  it('returns null for an empty set', () => {
    expect(mostRecentlyActive([])).toBeNull();
  });

  it('returns the one session in a singleton set', () => {
    const only = session('a', new Date('2026-01-01T00:00:00Z'));
    expect(mostRecentlyActive([only])).toBe(only);
  });

  it('picks the latest lastActiveAt among several', () => {
    const earliest = session('a', new Date('2026-01-01T00:00:00Z'));
    const latest = session('b', new Date('2026-01-02T00:00:00Z'));
    const middle = session('c', new Date('2026-01-01T12:00:00Z'));
    expect(mostRecentlyActive([earliest, latest, middle])).toBe(latest);
  });

  it('breaks a tie in lastActiveAt on the greater id, deterministically', () => {
    const same = new Date('2026-01-01T00:00:00Z');
    const lower = session('aaaa', same);
    const higher = session('bbbb', same);
    expect(mostRecentlyActive([lower, higher])).toBe(higher);
    expect(mostRecentlyActive([higher, lower])).toBe(higher);
  });
});
