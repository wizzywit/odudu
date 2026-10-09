import type { SigningKey } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import type { Authority } from '#/shared/service/principal.ts';
import { keysView, publishedKeys } from '#/features/overview/service/keys.ts';
import { rawJson } from '#/features/overview/service/discovery.ts';
import { type OverviewReads, type Read } from '#/features/overview/service/reads.ts';

const KEYS: readonly SigningKey[] = [
  {
    id: 'a',
    status: 'active',
    kid: 'kid-a',
    alg: 'ES256',
    created_at: '2026-09-01T00:00:00Z',
    not_after: null,
  },
  {
    id: 'r',
    status: 'rotating',
    kid: 'kid-r',
    alg: 'ES256',
    created_at: '2026-09-02T00:00:00Z',
    not_after: null,
  },
];

const OFF: Read<never> = { status: 'off' };

const LOADING: Read<never> = { status: 'loading' };

function ready<T>(data: T): Read<T> {
  return { status: 'ready', data };
}

function authority(...capabilities: Authority['capabilities'][number][]): Authority {
  return { capabilities, crossTenant: false };
}

function reads(over: Partial<OverviewReads> = {}): OverviewReads {
  return {
    discovery: OFF,
    jwks: OFF,
    counts: { subjects: OFF, clients: OFF, groups: OFF, roles: OFF, scopes: OFF },
    settings: OFF,
    smtp: OFF,
    keys: OFF,
    audit: OFF,
    ...over,
  };
}

describe('the published keys', () => {
  const jwks = {
    keys: [
      { kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' },
      { kty: 'EC', kid: 'kid-r', alg: 'ES256', use: 'sig' },
      { kty: 'RSA', kid: 'kid-x' },
    ],
  };

  it('names each key by its lane, matched on kid', () => {
    expect(publishedKeys(jwks, KEYS)).toEqual([
      { row: '0', kid: 'kid-a', kty: 'EC', alg: 'ES256', use: 'sig', lane: 'active' },
      { row: '1', kid: 'kid-r', kty: 'EC', alg: 'ES256', use: 'sig', lane: 'rotating' },
      { row: '2', kid: 'kid-x', kty: 'RSA', alg: null, use: null, lane: 'unlisted' },
    ]);
  });

  it('tells apart two keys that carry no kid', () => {
    const rows = publishedKeys({ keys: [{ kty: 'RSA' }, { kty: 'RSA' }] }, undefined);
    expect(new Set(rows.map((key) => key.row)).size).toBe(2);
  });

  it('keeps the whole set, laid out, for the raw view', () => {
    expect(rawJson(jwks)).toBe(JSON.stringify(jwks, null, 2));
  });

  it('says the lane is unknown when the keys could not be read', () => {
    expect(publishedKeys(jwks, undefined).map((key) => key.lane)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
});

describe('the published keys the overview lays out', () => {
  const jwks = ready({ keys: [{ kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' }] });

  it('carries each key in its lane when the key list was read', () => {
    const view = keysView(reads({ jwks, keys: ready(KEYS) }), authority('manage-keys'));
    expect(view).toMatchObject({
      status: 'ready',
      data: { lanesNeed: null, rows: [{ kid: 'kid-a', lane: 'active' }] },
    });
  });

  it('leaves the lane unknown and names the capability when the list is not held', () => {
    const view = keysView(reads({ jwks, keys: ready(KEYS) }), authority('view-users'));
    expect(view).toMatchObject({
      status: 'ready',
      data: { lanesNeed: 'manage-keys', rows: [{ lane: 'unknown' }] },
    });
  });

  it('is the JWKS read itself while it has not answered', () => {
    expect(keysView(reads({ jwks: LOADING }), undefined)).toEqual({ status: 'loading' });
  });
});
