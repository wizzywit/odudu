import { describe, expect, it } from 'vitest';
import {
  actorAdmission,
  instanceExpiry,
  mayActClaim,
  mintRefusal,
  narrowMayAct,
  combinedCeiling,
  runInstanceId,
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

describe('combinedCeiling', () => {
  it('is no ceiling when no delegation names the actor', () => {
    expect(combinedCeiling([])).toBeNull();
  });

  it('is the union of the delegations naming the actor', () => {
    expect(combinedCeiling(['a b', 'b c'])).toEqual(['a', 'b', 'c']);
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

describe('instanceExpiry with a time that is not a time', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const later = new Date(now.getTime() + 5_000_000);
  const base = { now, ttlSeconds: 900, parentExpiresAt: later, sessionEndsAt: null };

  it.each([
    ['an Invalid Date parent expiry', { ...base, parentExpiresAt: new Date(Number.NaN) }],
    ['an Invalid Date session end', { ...base, sessionEndsAt: new Date(Number.NaN) }],
    ['an Invalid Date now', { ...base, now: new Date(Number.NaN) }],
    ['an infinite ttl', { ...base, ttlSeconds: Number.POSITIVE_INFINITY }],
    ['a NaN ttl', { ...base, ttlSeconds: Number.NaN }],
    ['a zero ttl', { ...base, ttlSeconds: 0 }],
    ['a negative ttl', { ...base, ttlSeconds: -1 }],
  ])('has no expiry for %s', (_, input) => {
    expect(instanceExpiry(input)).toBeNull();
  });
});

describe('actorAdmission', () => {
  const none = { namedByConfig: false, ceilings: [] as string[], liveActors: 0 };

  it('permits any actor when no claim was made and no live source exists', () => {
    expect(actorAdmission({ ...none, claimPresent: false })).toEqual({ kind: 'ok', ceiling: null });
  });

  it('refuses an actor a persisted claim names when no live source does', () => {
    expect(actorAdmission({ ...none, claimPresent: true })).toEqual({ kind: 'refused' });
  });

  it('refuses an actor no live source names while others are named', () => {
    expect(actorAdmission({ ...none, liveActors: 2, claimPresent: false })).toEqual({
      kind: 'refused',
    });
  });

  it('has no ceiling when the client configuration alone names the actor', () => {
    expect(
      actorAdmission({ ...none, namedByConfig: true, liveActors: 1, claimPresent: true }),
    ).toEqual({ kind: 'ok', ceiling: null });
  });

  it('bounds by the delegations alone, whether or not the configuration also names the actor', () => {
    for (const namedByConfig of [false, true]) {
      expect(
        actorAdmission({ namedByConfig, ceilings: ['a b'], liveActors: 1, claimPresent: true }),
      ).toEqual({ kind: 'ok', ceiling: ['a', 'b'] });
    }
  });

  it('keeps an empty ceiling empty rather than unbounded', () => {
    expect(actorAdmission({ ...none, ceilings: [''], liveActors: 1, claimPresent: true })).toEqual({
      kind: 'ok',
      ceiling: [],
    });
  });
});

describe('mintRefusal', () => {
  it.each([
    ['scope_widened', 'invalid_scope'],
    ['parent_not_live', 'invalid_request'],
    ['invalid_expiry', 'invalid_request'],
    ['actor_not_permitted', 'access_denied'],
    ['ttl_exceeds_parent', 'invalid_request'],
    ['ttl_exceeds_session', 'invalid_request'],
    ['depth_exceeded', 'invalid_target'],
    ['fanout_exceeded', 'invalid_target'],
    ['live_instances_exceeded', 'invalid_target'],
  ] as const)('answers %s with %s', (invariant, error) => {
    expect(mintRefusal(invariant).error).toBe(error);
  });
});

describe('narrowMayAct', () => {
  it('reads back what mayActClaim wrote', () => {
    const one = { sub: 'a', iss: 'https://i' };
    expect(narrowMayAct(one)).toEqual(one);
    expect(narrowMayAct([one, { sub: 'b', iss: 'https://i' }])).toHaveLength(2);
  });

  it('has no claim for null and undefined', () => {
    expect(narrowMayAct(null)).toBeUndefined();
    expect(narrowMayAct(undefined)).toBeUndefined();
  });

  it('turns anything damaged into a claim that permits nobody', () => {
    expect(narrowMayAct('actor')).toEqual([]);
    expect(narrowMayAct([{ sub: 1 }])).toEqual([]);
  });
});

describe('runInstanceId', () => {
  const grant = '8f0d6a54-2c61-4b7a-9d0b-6a9d5f1a2b3c';
  const tenant = '0b3f7a1c-5d2e-4f8a-8c4d-1e2f3a4b5c6d';

  it('is a UUID, the same for the same run', () => {
    const id = runInstanceId(tenant, grant, 'conv-1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(runInstanceId(tenant, grant, 'conv-1')).toBe(id);
  });

  it('differs by key, grant and tenant', () => {
    const id = runInstanceId(tenant, grant, 'conv-1');
    expect(runInstanceId(tenant, grant, 'conv-2')).not.toBe(id);
    expect(runInstanceId(tenant, tenant, 'conv-1')).not.toBe(id);
    expect(runInstanceId(grant, grant, 'conv-1')).not.toBe(id);
  });

  it('does not let a key move across the fields it is hashed with', () => {
    expect(runInstanceId(tenant, grant, 'a:b')).not.toBe(runInstanceId(tenant, `${grant}:a`, 'b'));
  });
});
