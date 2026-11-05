import { describe, expect, it } from 'vitest';
import { discoveryDocument } from '#/discovery';
import { asMetadataDocument, CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED } from '#/as-metadata';

function discovery(over: { scopesSupported?: string[]; registration?: boolean } = {}) {
  return discoveryDocument({
    issuer: 'https://idp.example/tenants/acme/',
    claimsSupported: ['sub'],
    scopesSupported: over.scopesSupported ?? ['openid', 'profile'],
    uiLocalesSupported: ['en'],
    userinfoSigningAlgSupported: ['RS256', 'none'],
    userinfoEncryptionAlgSupported: ['RSA-OAEP-256'],
    userinfoEncryptionEncSupported: ['A128CBC-HS256'],
    ...(over.registration === true ? { clientRegistrationEnabled: true } : {}),
  });
}

describe('asMetadataDocument', () => {
  it('[RFC8414-2-01] names the authorization endpoint the discovery document does', () => {
    const d = discovery();
    expect(asMetadataDocument(d, ['openid']).authorization_endpoint).toBe(d.authorization_endpoint);
  });

  it('[RFC8414-2-02] names the token endpoint the discovery document does', () => {
    const d = discovery();
    expect(asMetadataDocument(d, ['openid']).token_endpoint).toBe(d.token_endpoint);
  });

  it('[RFC8414-2-03] lists response_types_supported', () => {
    expect(asMetadataDocument(discovery(), ['openid']).response_types_supported).toEqual(['code']);
  });

  it('states the issuer without a terminating slash', () => {
    expect(asMetadataDocument(discovery(), ['openid']).issuer).toBe(
      'https://idp.example/tenants/acme',
    );
  });

  it('[RFC8414-2-04] states token endpoint assertion algorithms beside private_key_jwt', () => {
    const m = asMetadataDocument(discovery(), ['openid']);
    expect(m.token_endpoint_auth_methods_supported).toContain('private_key_jwt');
    expect(m.token_endpoint_auth_signing_alg_values_supported).toEqual(
      CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED,
    );
  });

  it('[RFC8414-2-05] states revocation assertion algorithms beside private_key_jwt', () => {
    const m = asMetadataDocument(discovery(), ['openid']);
    expect(m.revocation_endpoint_auth_methods_supported).toContain('private_key_jwt');
    expect(m.revocation_endpoint_auth_signing_alg_values_supported).toEqual(
      CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED,
    );
  });

  it('[RFC8414-2-06] states introspection assertion algorithms beside private_key_jwt', () => {
    const m = asMetadataDocument(discovery(), ['openid']);
    expect(m.introspection_endpoint_auth_methods_supported).toContain('private_key_jwt');
    expect(m.introspection_endpoint_auth_signing_alg_values_supported).toEqual(
      CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED,
    );
  });

  it('[RFC8414-2-07] never lists none as an assertion algorithm', () => {
    const m = asMetadataDocument(discovery(), ['openid']);
    for (const algs of [
      m.token_endpoint_auth_signing_alg_values_supported,
      m.revocation_endpoint_auth_signing_alg_values_supported,
      m.introspection_endpoint_auth_signing_alg_values_supported,
    ]) {
      expect(algs).not.toContain('none');
    }
  });

  it('[RFC8414-2-08] lists RS256 as an assertion algorithm', () => {
    expect(CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED).toContain('RS256');
  });

  it('[RFC8414-2-09] advertises the scopes it is handed', () => {
    const m = asMetadataDocument(discovery(), ['mcp:read', 'openid']);
    expect(m.scopes_supported).toEqual(['mcp:read', 'openid']);
  });

  it('[RFC8414-3.2-03] omits a member with zero elements', () => {
    const m = asMetadataDocument(discovery(), []);
    expect(m).not.toHaveProperty('scopes_supported');
  });

  it('carries registration_endpoint only when the discovery document does', () => {
    expect(asMetadataDocument(discovery(), [])).not.toHaveProperty('registration_endpoint');
    const d = discovery({ registration: true });
    expect(asMetadataDocument(d, []).registration_endpoint).toBe(d.registration_endpoint);
  });

  it('states client_id_metadata_document_supported as true only when told documents are served', () => {
    expect(asMetadataDocument(discovery(), [])).not.toHaveProperty(
      'client_id_metadata_document_supported',
    );
    expect(asMetadataDocument(discovery(), [], false)).not.toHaveProperty(
      'client_id_metadata_document_supported',
    );
    expect(asMetadataDocument(discovery(), [], true).client_id_metadata_document_supported).toBe(
      true,
    );
  });

  it('shares with the discovery document every member both define, equal', () => {
    const d = discovery({ registration: true });
    const m = asMetadataDocument(d, ['openid', 'profile']);
    const shared = Object.keys(m).filter((k) => k in d && k !== 'scopes_supported');
    expect(shared.length).toBeGreaterThan(10);
    for (const key of shared) {
      expect(m[key as keyof typeof m], key).toEqual(d[key as keyof typeof d]);
    }
  });
});
