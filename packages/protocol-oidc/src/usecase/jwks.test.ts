import { describe, expect, it } from 'vitest';
import { resolveJwks } from '#/usecase/jwks';

const publicJwk = { kty: 'RSA', n: 'n-value', e: 'AQAB' };

describe('resolveJwks', () => {
  it('returns null for an unknown realm', async () => {
    const jwks = await resolveJwks(
      { findRealm: () => Promise.resolve(null), listPublishableKeys: () => Promise.resolve([]) },
      'no-such-realm',
    );
    expect(jwks).toBeNull();
  });

  it('returns null for a disabled realm without reading keys', async () => {
    let calledListKeys = false;
    const jwks = await resolveJwks(
      {
        findRealm: () => Promise.resolve({ id: 'r1', enabled: false }),
        listPublishableKeys: () => {
          calledListKeys = true;
          return Promise.resolve([]);
        },
      },
      'disabled-realm',
    );
    expect(jwks).toBeNull();
    expect(calledListKeys).toBe(false);
  });

  it('assembles the published set for an enabled realm', async () => {
    const jwks = await resolveJwks(
      {
        findRealm: () => Promise.resolve({ id: 'r1', enabled: true }),
        listPublishableKeys: () => Promise.resolve([{ kid: 'a', alg: 'RS256', publicJwk }]),
      },
      'acme',
    );
    expect(jwks?.keys).toHaveLength(1);
    expect(jwks?.keys[0]).toMatchObject({ kid: 'a', alg: 'RS256', kty: 'RSA' });
  });
});
