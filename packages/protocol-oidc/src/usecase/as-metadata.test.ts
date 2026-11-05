import { pathAddress, domainAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { resolveAsMetadata, type AsMetadataUsecaseDeps } from '#/usecase/as-metadata';
import { resolveDiscoveryDocument } from '#/usecase/discovery';

const TENANT = {
  id: 'r1',
  enabled: true,
  verifyEmail: false,
  ssoSessionMaxSeconds: 36_000,
  ssoSessionIdleSeconds: 1_800,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
  rememberMeAllowed: false,
  loginWithEmail: false,
  registrationAllowed: false,
  resetPasswordAllowed: false,
  maxSessionsPerBrowser: 25,
  clientRegistrationPolicy: 'disabled' as 'disabled' | 'open',
  cimdEnabled: false,
  supportedLocales: ['en'],
  defaultLocale: null,
  passwordRules: {
    minLength: 15,
    requireDigit: false,
    requireUppercase: false,
    requireLowercase: false,
    requireSpecial: false,
  },
};

function deps(over: Partial<typeof TENANT> | null = {}): AsMetadataUsecaseDeps {
  return {
    findTenant: () => Promise.resolve(over === null ? null : { ...TENANT, ...over }),
    claimNames: () => Promise.resolve(['sub']),
    scopesForTenant: () => Promise.resolve(['profile', 'openid']),
    algorithmsAvailable: () => Promise.resolve(['RS256']),
    userinfoEncryptionAlgSupported: ['RSA-OAEP-256'],
    userinfoEncryptionEncSupported: ['A128CBC-HS256'],
    trustProxy: false,
  };
}

const PATH = pathAddress('https://idp.example', 'acme');

describe('resolveAsMetadata', () => {
  it('[RFC8414-3.3-01] states the issuer of the address it is read at', async () => {
    const atPath = await resolveAsMetadata(deps(), 'acme', PATH);
    expect(atPath?.issuer).toBe('https://idp.example/tenants/acme');
    const atDomain = await resolveAsMetadata(deps(), 'acme', domainAddress('login.acme.com', true));
    expect(atDomain?.issuer).toBe('https://login.acme.com');
    expect(atDomain?.token_endpoint).toBe('https://login.acme.com/protocol/openid-connect/token');
  });

  it('[RFC8414-2-00] always carries an issuer', async () => {
    const m = await resolveAsMetadata(deps(), 'acme', PATH);
    expect(m?.issuer).toMatch(/^https:\/\//u);
  });

  it('[RFC8414-3.1-02] states an issuer with no terminating slash', async () => {
    const m = await resolveAsMetadata(deps(), 'acme', pathAddress('https://idp.example/', 'acme'));
    expect(m?.issuer).toBe('https://idp.example/tenants/acme');
  });

  it('advertises PKCE S256, the iss parameter, and none beside private_key_jwt', async () => {
    const m = await resolveAsMetadata(deps(), 'acme', PATH);
    expect(m?.code_challenge_methods_supported).toEqual(['S256']);
    expect(m?.authorization_response_iss_parameter_supported).toBe(true);
    expect(m?.token_endpoint_auth_methods_supported).toEqual(
      expect.arrayContaining(['none', 'private_key_jwt']),
    );
  });

  it('[RFC8414-2-09] adds the MCP scopes to the tenant scopes, sorted', async () => {
    const m = await resolveAsMetadata(deps(), 'acme', PATH);
    expect(m?.scopes_supported).toEqual(['mcp:read', 'mcp:write', 'openid', 'profile']);
  });

  it('leaves the OIDC discovery document without the MCP scopes', async () => {
    const d = await resolveDiscoveryDocument(deps(), 'acme', PATH);
    expect(d?.scopes_supported).toEqual(['openid', 'profile']);
  });

  it('carries registration_endpoint only while the policy allows registration', async () => {
    expect(await resolveAsMetadata(deps(), 'acme', PATH)).not.toHaveProperty(
      'registration_endpoint',
    );
    const open = await resolveAsMetadata(deps({ clientRegistrationPolicy: 'open' }), 'acme', PATH);
    expect(open?.registration_endpoint).toBe(
      'https://idp.example/tenants/acme/clients-registrations/openid-connect',
    );
  });

  it('states client_id_metadata_document_supported only for a tenant that has turned them on', async () => {
    const wired = (over: Partial<typeof TENANT>) => ({ ...deps(over), cimdFetchable: true });
    expect(await resolveAsMetadata(wired({ cimdEnabled: true }), 'acme', PATH)).toMatchObject({
      client_id_metadata_document_supported: true,
    });
    expect(await resolveAsMetadata(wired({ cimdEnabled: false }), 'acme', PATH)).not.toHaveProperty(
      'client_id_metadata_document_supported',
    );
  });

  it('leaves client_id_metadata_document_supported out when the process cannot fetch a document', async () => {
    expect(await resolveAsMetadata(deps({ cimdEnabled: true }), 'acme', PATH)).not.toHaveProperty(
      'client_id_metadata_document_supported',
    );
  });

  it('returns null for an unknown tenant and for a disabled one', async () => {
    expect(await resolveAsMetadata(deps(null), 'acme', PATH)).toBeNull();
    expect(await resolveAsMetadata(deps({ enabled: false }), 'acme', PATH)).toBeNull();
  });

  it('looks the tenant up once', async () => {
    let lookups = 0;
    const counted = { ...deps(), findTenant: () => (lookups++, Promise.resolve(TENANT)) };
    await resolveAsMetadata(counted, 'acme', PATH);
    expect(lookups).toBe(1);
  });

  it('agrees with the discovery document on every member both state', async () => {
    const d = await resolveDiscoveryDocument(
      deps({ clientRegistrationPolicy: 'open' }),
      'acme',
      PATH,
    );
    const m = await resolveAsMetadata(deps({ clientRegistrationPolicy: 'open' }), 'acme', PATH);
    if (d === null || m === null) throw new Error('expected documents');
    const shared = Object.keys(m).filter((k) => k in d && k !== 'scopes_supported');
    expect(shared.length).toBeGreaterThan(10);
    for (const key of shared) {
      expect(m[key as keyof typeof m], key).toEqual(d[key as keyof typeof d]);
    }
  });
});
