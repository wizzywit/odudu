import { sessionKey } from '@odudu-io/bff/shared';
import { describe, expect, it } from 'vitest';
import { sessionFromStore } from '#/services/claims';

const ID = 'D'.repeat(43);
const NOW = 1_800_000_000_000;

function record(overrides: { claims?: unknown; refreshToken?: string; expiresAt?: number } = {}) {
  return {
    kind: 'session' as const,
    createdAt: 0,
    tokens: {
      issuer: 'https://id.example',
      clientId: 'web',
      idToken: 'id-token-text',
      byAudience: {
        'https://id.example': {
          accessToken: 'access-token-text',
          expiresAt: overrides.expiresAt ?? NOW + 900_000,
        },
      },
      claims: 'claims' in overrides ? overrides.claims : { sub: 'a', name: 'Ada' },
      ...(overrides.refreshToken === undefined ? {} : { refreshToken: overrides.refreshToken }),
    } as never,
  };
}

const lookupOf = (found: unknown) => {
  const keys: string[] = [];
  return {
    keys,
    lookup: (key: string) => {
      keys.push(key);
      return Promise.resolve(found as never);
    },
  };
};

describe('sessionFromStore', () => {
  it('reads the claims, under the key the BFF stores a session by, and nothing else', async () => {
    const { keys, lookup } = lookupOf(record());
    const session = await sessionFromStore(ID, lookup, NOW);
    expect(session).toEqual({ claims: { sub: 'a', name: 'Ada' } });
    expect(keys).toEqual([sessionKey(ID)]);
    expect(JSON.stringify(session)).not.toMatch(/token-text/u);
  });

  it('still reads a session whose access token is about to expire', async () => {
    const { lookup } = lookupOf(record({ expiresAt: NOW + 5_000, refreshToken: 'r' }));
    expect(await sessionFromStore(ID, lookup, NOW)).not.toBeNull();
  });

  it('still reads a session whose access token ran out when a refresh token is held', async () => {
    const { lookup } = lookupOf(record({ expiresAt: NOW - 5_000, refreshToken: 'r' }));
    expect(await sessionFromStore(ID, lookup, NOW)).not.toBeNull();
  });

  it('reads a session that ran out with no refresh token as none', async () => {
    const { lookup } = lookupOf(record({ expiresAt: NOW - 1 }));
    expect(await sessionFromStore(ID, lookup, NOW)).toBeNull();
  });

  it.each([undefined, '', 'short', 'x'.repeat(44)])('does not ask the store for %j', async (id) => {
    const { keys, lookup } = lookupOf(record());
    expect(await sessionFromStore(id, lookup, NOW)).toBeNull();
    expect(keys).toEqual([]);
  });

  it('reads nothing found, or a login record, as none', async () => {
    expect(await sessionFromStore(ID, lookupOf(undefined).lookup, NOW)).toBeNull();
    const login = { kind: 'login', pending: {}, createdAt: 0 };
    expect(await sessionFromStore(ID, lookupOf(login).lookup, NOW)).toBeNull();
  });

  it.each([null, 'x', [], {}, { name: 'no subject' }, { sub: 4 }])(
    'reads claims %j as none',
    async (claims) => {
      expect(await sessionFromStore(ID, lookupOf(record({ claims })).lookup, NOW)).toBeNull();
    },
  );
});
