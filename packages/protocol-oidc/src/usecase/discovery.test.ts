import { describe, expect, it } from 'vitest';
import { resolveDiscoveryDocument } from '#/usecase/discovery';

const claimNames = () => ['sub', 'name', 'email', 'email_verified'];
// Rows come back from client_scopes in no particular order, so this returns
// them out of order deliberately.
const scopesForRealm = () => Promise.resolve(['profile', 'openid', 'email']);

describe('resolveDiscoveryDocument', () => {
  it('returns null for an unknown realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve(null), claimNames, scopesForRealm, trustProxy: false },
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
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
        trustProxy: false,
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
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
        trustProxy: false,
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
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
        trustProxy: false,
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
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
        trustProxy: false,
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
              rememberMeIdleSeconds: 604_800,
              rememberMeMaxSeconds: 2_592_000,
              rememberMeAllowed: false,
              maxSessionsPerBrowser: 25,
              clientRegistrationPolicy,
            }),
          claimNames,
          scopesForRealm,
          trustProxy: false,
        },
        'acme',
        'https://idp.example',
      );
      expect(doc?.registration_endpoint).toBe(
        'https://idp.example/realms/acme/clients-registrations/openid-connect',
      );
    },
  );

  // The design decision this pins:
  // docs/superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md:596-598 —
  // unset ODUDU_TRUST_PROXY means tls_client_auth is unavailable, so
  // discovery must not name it either.
  it.each([false, true])(
    'advertises tls_client_auth only when trustProxy is %s',
    async (trustProxy) => {
      const doc = await resolveDiscoveryDocument(
        {
          findRealm: () =>
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
          claimNames,
          scopesForRealm,
          trustProxy,
        },
        'acme',
        'https://idp.example',
      );
      expect(doc?.token_endpoint_auth_methods_supported.includes('tls_client_auth')).toBe(
        trustProxy,
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
            rememberMeIdleSeconds: 604_800,
            rememberMeMaxSeconds: 2_592_000,
            rememberMeAllowed: false,
            maxSessionsPerBrowser: 25,
            clientRegistrationPolicy: 'disabled',
          }),
        claimNames,
        scopesForRealm,
        trustProxy: false,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc).not.toHaveProperty('registration_endpoint');
  });
});
