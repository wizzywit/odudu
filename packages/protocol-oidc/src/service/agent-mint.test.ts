import { describe, expect, it } from 'vitest';
import {
  instanceExpiry,
  mayActClaim,
  mintRefusal,
  narrowestCeiling,
  normaliseScope,
} from '#/service/agent-mint';

describe('mayActClaim', () => {
  const iss = 'https://issuer.example';

  it('is absent when nobody is named', () => {
    expect(mayActClaim([], iss)).toBeUndefined();
  });

  it('is the RFC 8693 object for one actor', () => {
    expect(mayActClaim(['agent-a'], iss)).toEqual({ sub: 'agent-a', iss });
  });

  it('lists several actors once each, in a stable order', () => {
    expect(mayActClaim(['b', 'a', 'b'], iss)).toEqual([
      { sub: 'a', iss },
      { sub: 'b', iss },
    ]);
  });
});

describe('narrowestCeiling', () => {
  it('is unbounded when no delegation names the actor', () => {
    expect(narrowestCeiling([])).toBeNull();
  });

  it('is the union of the delegations naming the actor', () => {
    expect(narrowestCeiling(['a b', 'b c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('normaliseScope', () => {
  it('drops duplicates and keeps order', () => {
    expect(normaliseScope(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('refuses an empty scope and an entry holding a space or nothing', () => {
    expect(normaliseScope([])).toBeNull();
    expect(normaliseScope([''])).toBeNull();
    expect(normaliseScope(['a b'])).toBeNull();
  });
});

describe('instanceExpiry', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it('is the least of the parent, the session end and now plus the ttl', () => {
    expect(
      instanceExpiry({ now, ttlSeconds: 900, parentExpiresAt: at(5000), sessionEndsAt: null }),
    ).toEqual(at(900));
    expect(
      instanceExpiry({ now, ttlSeconds: 900, parentExpiresAt: at(100), sessionEndsAt: at(500) }),
    ).toEqual(at(100));
    expect(
      instanceExpiry({ now, ttlSeconds: 900, parentExpiresAt: at(5000), sessionEndsAt: at(300) }),
    ).toEqual(at(300));
  });
});

describe('mintRefusal', () => {
  it.each([
    ['scope_widened', 'invalid_scope'],
    ['ttl_exceeds_parent', 'invalid_request'],
    ['ttl_exceeds_session', 'invalid_request'],
    ['depth_exceeded', 'invalid_target'],
    ['fanout_exceeded', 'invalid_target'],
    ['live_instances_exceeded', 'invalid_target'],
  ] as const)('answers %s with %s', (invariant, error) => {
    expect(mintRefusal(invariant).error).toBe(error);
  });
});
