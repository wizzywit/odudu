import { describe, expect, it } from 'vitest';
import { keysView, publishedKeys } from '#/features/overview/services/keys';
import { rawJson } from '#/features/overview/services/discovery';
import { LOADING, ready, authority, reads, KEYS } from '#/testing/overviewFixtures';

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
