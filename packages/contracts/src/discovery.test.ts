import { describe, expect, it } from 'vitest';
import { discoveryDocument } from '#/discovery';

const CLAIMS_SUPPORTED = ['sub', 'name', 'email', 'email_verified'];

const doc = discoveryDocument({
  issuer: 'https://idp.example/realms/acme',
  claimsSupported: CLAIMS_SUPPORTED,
});

describe('[OIDC-DISCOVERY-3-01] the discovery document', () => {
  it('advertises only the code response type', () => {
    expect(doc.response_types_supported).toEqual(['code']);
  });

  it('advertises S256 and never plain', () => {
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
  });

  // Omitting this member does not mean "no opinion": OIDC Discovery §3
  // gives it the default ["query", "fragment"], which would promise a
  // delivery mode /authorize refuses.
  it('advertises only the query response mode', () => {
    expect(doc.response_modes_supported).toEqual(['query']);
  });

  it('advertises the iss parameter', () => {
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });

  it('advertises exactly the three grant types P1 implements', () => {
    expect([...doc.grant_types_supported].sort()).toEqual([
      'authorization_code',
      'client_credentials',
      'refresh_token',
    ]);
  });

  it('advertises exactly the three client authentication methods the token endpoint honours', () => {
    expect([...doc.token_endpoint_auth_methods_supported].sort()).toEqual([
      'client_secret_basic',
      'client_secret_post',
      'none',
    ]);
  });

  it('names the issuer with no trailing slash', () => {
    expect(doc.issuer).toBe('https://idp.example/realms/acme');
  });

  it('strips a trailing slash from a supplied issuer', () => {
    const trimmed = discoveryDocument({
      issuer: 'https://idp.example/realms/acme/',
      claimsSupported: CLAIMS_SUPPORTED,
    });
    expect(trimmed.issuer).toBe('https://idp.example/realms/acme');
  });

  it('carries no query or fragment and preserves the https scheme', () => {
    const parsed = new URL(doc.issuer);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe('');
  });

  it('places every advertised endpoint under the issuer', () => {
    for (const url of [
      doc.authorization_endpoint,
      doc.token_endpoint,
      doc.userinfo_endpoint,
      doc.jwks_uri,
    ]) {
      expect(url.startsWith(`${doc.issuer}/`)).toBe(true);
    }
  });

  it('advertises exactly one public subject type', () => {
    expect(doc.subject_types_supported).toEqual(['public']);
  });

  it('advertises RS256 and ES256 for ID token signing', () => {
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256', 'ES256']);
  });

  it('advertises openid, profile and email', () => {
    expect([...doc.scopes_supported].sort()).toEqual(['email', 'openid', 'profile']);
  });

  it('advertises exactly the claims_supported list it was given, never a hardcoded one', () => {
    expect(doc.claims_supported).toBe(CLAIMS_SUPPORTED);
  });
});

describe('[OIDC-DISCOVERY-4.2-01] a metadata claim with zero elements', () => {
  it('never appears in the document as an empty array or a null', () => {
    for (const [member, value] of Object.entries(doc)) {
      expect(value, member).not.toBeNull();
      if (Array.isArray(value)) {
        expect(value, member).not.toHaveLength(0);
      }
    }
  });

  // Every other list in the document is built here from a literal that is
  // never empty; claims_supported is the one passed in, so it is the only
  // member whose emptiness is reachable from outside this package.
  it('is omitted rather than published empty when the supplied claim list is empty', () => {
    const noClaims = discoveryDocument({
      issuer: 'https://idp.example/realms/acme',
      claimsSupported: [],
    });
    expect(Object.keys(noClaims)).not.toContain('claims_supported');
    expect(JSON.stringify(noClaims)).not.toContain('claims_supported');
  });

  // Dynamic client registration is P3's work: the member is left out
  // altogether rather than published as null or an empty string.
  it('leaves registration_endpoint out of the document entirely', () => {
    expect(Object.keys(doc)).not.toContain('registration_endpoint');
  });
});
