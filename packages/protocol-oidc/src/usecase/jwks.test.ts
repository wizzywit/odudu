import { describe, expect, it } from 'vitest';
import { resolveJwks } from '#/usecase/jwks';

const publicJwk = { kty: 'RSA', n: 'n-value', e: 'AQAB' };

describe('resolveJwks', () => {
  it('returns null for an unknown tenant', async () => {
    const jwks = await resolveJwks(
      { findTenant: () => Promise.resolve(null), listPublishableKeys: () => Promise.resolve([]) },
      'no-such-tenant',
    );
    expect(jwks).toBeNull();
  });

  it('returns null for a disabled tenant without reading keys', async () => {
    let calledListKeys = false;
    const jwks = await resolveJwks(
      {
        findTenant: () =>
          Promise.resolve({
            id: 'r1',
            enabled: false,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        listPublishableKeys: () => {
          calledListKeys = true;
          return Promise.resolve([]);
        },
      },
      'disabled-tenant',
    );
    expect(jwks).toBeNull();
    expect(calledListKeys).toBe(false);
  });

  it('assembles the published set for an enabled tenant', async () => {
    const jwks = await resolveJwks(
      {
        findTenant: () =>
          Promise.resolve({
            id: 'r1',
            enabled: true,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        listPublishableKeys: () => Promise.resolve([{ kid: 'a', alg: 'RS256', publicJwk }]),
      },
      'acme',
    );
    expect(jwks?.keys).toHaveLength(1);
    expect(jwks?.keys[0]).toMatchObject({ kid: 'a', alg: 'RS256', kty: 'RSA' });
  });
});
