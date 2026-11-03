import { describe, expect, it } from 'vitest';
import { keysView, publishedKeys } from '#/features/overview/services/keys';
import { rawJson } from '#/features/overview/services/discovery';
import {
  TRANSCRIPT_JWKS,
  LOADING,
  ready,
  authority,
  areaOf,
  reads,
  KEYS,
  RULES,
} from '#/testing/overviewFixtures';

describe('the published keys', () => {
  const jwks = {
    keys: [
      { kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' },
      { kty: 'EC', kid: 'kid-r', alg: 'ES256', use: 'sig' },
      { kty: 'RSA', kid: 'kid-x' },
    ],
  };

  it('names each key by its lane, matched on kid', () => {
    expect(publishedKeys(jwks, KEYS, RULES.publishedLane)).toEqual([
      {
        row: '0',
        kid: 'kid-a',
        kty: 'EC',
        alg: 'ES256',
        use: 'sig',
        lane: 'active',
        laneLabel: 'active',
      },
      {
        row: '1',
        kid: 'kid-r',
        kty: 'EC',
        alg: 'ES256',
        use: 'sig',
        lane: 'rotating',
        laneLabel: 'rotating',
      },
      {
        row: '2',
        kid: 'kid-x',
        kty: 'RSA',
        alg: null,
        use: null,
        lane: 'unlisted',
        laneLabel: 'not in the key list',
      },
    ]);
  });

  it('tells apart two keys that carry no kid', () => {
    const rows = publishedKeys(
      { keys: [{ kty: 'RSA' }, { kty: 'RSA' }] },
      undefined,
      RULES.publishedLane,
    );
    expect(new Set(rows.map((key) => key.row)).size).toBe(2);
  });

  it('keeps the whole set, laid out, for the raw view', () => {
    expect(rawJson(jwks)).toBe(JSON.stringify(jwks, null, 2));
  });

  it('says the lane is unknown when the keys could not be read', () => {
    expect(publishedKeys(jwks, undefined, RULES.publishedLane).map((key) => key.lane)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
});

describe('the published keys the overview lays out', () => {
  const jwks = ready({ keys: [{ kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' }] });

  it('carries each key in its lane when the key list was read', () => {
    const view = keysView(
      reads({ jwks, keys: ready(KEYS) }),
      authority('manage-keys'),
      areaOf,
      RULES,
    );
    expect(view).toMatchObject({
      status: 'ready',
      data: { lanesNeed: null, rows: [{ kid: 'kid-a', lane: 'active' }] },
    });
  });

  it('leaves the lane unknown and names the capability when the list is not held', () => {
    const view = keysView(
      reads({ jwks, keys: ready(KEYS) }),
      authority('view-users'),
      areaOf,
      RULES,
    );
    expect(view).toMatchObject({
      status: 'ready',
      data: { lanesNeed: 'manage-keys', rows: [{ lane: 'unknown' }] },
    });
  });

  it('is the JWKS read itself while it has not answered', () => {
    expect(keysView(reads({ jwks: LOADING }), undefined, areaOf, RULES)).toEqual({
      status: 'loading',
    });
  });
});

describe('the published keys a running server published', () => {
  it('carries the one RSA key with its kid, algorithm and use, and no lane when the list is unread', () => {
    const [row] = publishedKeys(TRANSCRIPT_JWKS, undefined, RULES.publishedLane);
    expect(row).toMatchObject({
      kid: '01a0ea7f-01af-7637-a8b5-093872f1685f',
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      lane: 'unknown',
    });
  });
});
