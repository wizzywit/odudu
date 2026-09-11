import { describe, expect, it } from 'vitest';
import { discoveryDocument } from '#/discovery';

const doc = discoveryDocument({ issuer: 'https://idp.example/realms/acme' });

describe('[OIDC-DISCOVERY-3-01] the discovery document', () => {
  it('advertises only the code response type', () => {
    expect(doc.response_types_supported).toEqual(['code']);
  });

  it('advertises S256 and never plain', () => {
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
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

  it('names the issuer with no trailing slash', () => {
    expect(doc.issuer).toBe('https://idp.example/realms/acme');
  });

  it('strips a trailing slash from a supplied issuer', () => {
    const trimmed = discoveryDocument({ issuer: 'https://idp.example/realms/acme/' });
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

  it('advertises at least one claim name', () => {
    expect(doc.claims_supported.length).toBeGreaterThan(0);
  });
});
