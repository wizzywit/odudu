import { describe, expect, it } from 'vitest';
import { resolveDiscoveryDocument } from '#/usecase/discovery';

const claimNames = () => ['sub', 'name', 'email', 'email_verified'];
// Rows come back from client_scopes in no particular order, so this returns
// them out of order deliberately.
const scopesForRealm = () => Promise.resolve(['profile', 'openid', 'email']);

describe('resolveDiscoveryDocument', () => {
  it('returns null for an unknown realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve(null), claimNames, scopesForRealm },
      'no-such-realm',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('returns null for a disabled realm', async () => {
    const doc = await resolveDiscoveryDocument(
      {
        findRealm: () =>
          Promise.resolve({
            id: 'r1',
            enabled: false,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
      },
      'disabled-realm',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('builds the document under the resolved issuer for an enabled realm', async () => {
    const doc = await resolveDiscoveryDocument(
      {
        findRealm: () =>
          Promise.resolve({
            id: 'r1',
            enabled: true,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc?.issuer).toBe('https://idp.example/realms/acme');
  });

  it('builds scopes_supported from the realm, in a stable order', async () => {
    const doc = await resolveDiscoveryDocument(
      {
        findRealm: () =>
          Promise.resolve({
            id: 'r1',
            enabled: true,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc?.scopes_supported).toEqual(['email', 'openid', 'profile']);
  });

  it('builds claims_supported from the claim mapper registry, not a literal', async () => {
    const doc = await resolveDiscoveryDocument(
      {
        findRealm: () =>
          Promise.resolve({
            id: 'r1',
            enabled: true,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
      },
      'acme',
      'https://idp.example',
    );
    expect([...(doc?.claims_supported ?? [])].sort()).toEqual([
      'email',
      'email_verified',
      'name',
      'sub',
    ]);
  });

  // Would still pass a version that always advertises the endpoint, or one
  // that never does — the two assertions below pin both directions, so a
  // regression toward either constant fails one of them.
  it.each(['open', 'token'] as const)(
    'advertises registration_endpoint while the policy is %s',
    async (clientRegistrationPolicy) => {
      const doc = await resolveDiscoveryDocument(
        {
          findRealm: () =>
            Promise.resolve({
              id: 'r1',
              enabled: true,
              verifyEmail: false,
              ssoSessionMaxSeconds: 36_000,
              ssoSessionIdleSeconds: 1_800,
              clientRegistrationPolicy,
            }),
          claimNames,
          scopesForRealm,
        },
        'acme',
        'https://idp.example',
      );
      expect(doc?.registration_endpoint).toBe(
        'https://idp.example/realms/acme/clients-registrations/openid-connect',
      );
    },
  );

  it('omits registration_endpoint while the policy is disabled', async () => {
    const doc = await resolveDiscoveryDocument(
      {
        findRealm: () =>
          Promise.resolve({
            id: 'r1',
            enabled: true,
            verifyEmail: false,
            ssoSessionMaxSeconds: 36_000,
            ssoSessionIdleSeconds: 1_800,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc).not.toHaveProperty('registration_endpoint');
  });
});
