import { describe, expect, it } from 'vitest';
import { resolveDiscoveryDocument } from '#/usecase/discovery';

const claimNames = () => Promise.resolve(['sub', 'name', 'email', 'email_verified']);
// Rows come back from client_scopes in no particular order, so this returns
// them out of order deliberately.
const scopesForTenant = () => Promise.resolve(['profile', 'openid', 'email']);
const algorithmsAvailable = () => Promise.resolve(['RS256']);
const userinfoEncryptionAlgSupported = ['RSA-OAEP-256'];
const userinfoEncryptionEncSupported = ['A128CBC-HS256'];

describe('resolveDiscoveryDocument', () => {
  it('returns null for an unknown tenant', async () => {
    const doc = await resolveDiscoveryDocument(
      {
        findTenant: () => Promise.resolve(null),
        claimNames,
        scopesForTenant,
        algorithmsAvailable,
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'no-such-tenant',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('returns null for a disabled tenant', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable,
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'disabled-tenant',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('builds the document under the resolved issuer for an enabled tenant', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable,
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc?.issuer).toBe('https://idp.example/tenants/acme');
  });

  it('builds scopes_supported from the tenant, in a stable order', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable,
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable,
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
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
              clientRegistrationPolicy,
            }),
          claimNames,
          scopesForTenant,
          algorithmsAvailable,
          userinfoEncryptionAlgSupported,
          userinfoEncryptionEncSupported,
          trustProxy: false,
        },
        'acme',
        'https://idp.example',
      );
      expect(doc?.registration_endpoint).toBe(
        'https://idp.example/tenants/acme/clients-registrations/openid-connect',
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
          claimNames,
          scopesForTenant,
          algorithmsAvailable,
          userinfoEncryptionAlgSupported,
          userinfoEncryptionEncSupported,
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

  it('advertises every available signing algorithm plus none, never a fixed pair', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable: () => Promise.resolve(['ES256']),
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc?.userinfo_signing_alg_values_supported).toEqual(['ES256', 'none']);
  });

  it('advertises the caller-supplied encryption alg/enc values, unlike signing, unconditioned on the tenant', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable: () => Promise.resolve([]),
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc?.userinfo_encryption_alg_values_supported).toEqual(userinfoEncryptionAlgSupported);
    expect(doc?.userinfo_encryption_enc_values_supported).toEqual(userinfoEncryptionEncSupported);
  });

  it('advertises only none for a tenant with no signing key yet', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable: () => Promise.resolve([]),
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc?.userinfo_signing_alg_values_supported).toEqual(['none']);
  });

  it('omits registration_endpoint while the policy is disabled', async () => {
    const doc = await resolveDiscoveryDocument(
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
        claimNames,
        scopesForTenant,
        algorithmsAvailable,
        userinfoEncryptionAlgSupported,
        userinfoEncryptionEncSupported,
        trustProxy: false,
      },
      'acme',
      'https://idp.example',
    );
    expect(doc).not.toHaveProperty('registration_endpoint');
  });
});
