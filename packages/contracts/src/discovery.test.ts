import { describe, expect, it } from 'vitest';
import { discoveryDocument } from '#/discovery';

const CLAIMS_SUPPORTED = ['sub', 'name', 'email', 'email_verified'];
// Stands in for a realm's scope vocabulary, which is what the caller reads
// and hands over; this package has no list of its own to fall back to.
const SCOPES_SUPPORTED = ['openid', 'profile', 'email'];

const doc = discoveryDocument({
  issuer: 'https://idp.example/realms/acme',
  claimsSupported: CLAIMS_SUPPORTED,
  scopesSupported: SCOPES_SUPPORTED,
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

  it('advertises exactly the three grant types P1 implements', () => {
    expect([...doc.grant_types_supported].sort()).toEqual([
      'authorization_code',
      'client_credentials',
      'refresh_token',
    ]);
  });

  it('advertises exactly the four client authentication methods the token endpoint honours', () => {
    expect([...doc.token_endpoint_auth_methods_supported].sort()).toEqual([
      'client_secret_basic',
      'client_secret_post',
      'none',
      'private_key_jwt',
    ]);
  });

  it('names the issuer with no trailing slash', () => {
    expect(doc.issuer).toBe('https://idp.example/realms/acme');
  });

  it('strips a trailing slash from a supplied issuer', () => {
    const trimmed = discoveryDocument({
      issuer: 'https://idp.example/realms/acme/',
      claimsSupported: CLAIMS_SUPPORTED,
      scopesSupported: SCOPES_SUPPORTED,
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
      doc.introspection_endpoint,
      doc.revocation_endpoint,
      doc.userinfo_endpoint,
      doc.jwks_uri,
      doc.end_session_endpoint,
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

  it('advertises exactly the scopes_supported list it was given, never a hardcoded one', () => {
    expect(doc.scopes_supported).toBe(SCOPES_SUPPORTED);
  });

  it('advertises exactly the claims_supported list it was given, never a hardcoded one', () => {
    expect(doc.claims_supported).toBe(CLAIMS_SUPPORTED);
  });

  it('omits registration_endpoint when clientRegistrationEnabled is not passed', () => {
    expect(doc).not.toHaveProperty('registration_endpoint');
  });

  it('advertises registration_endpoint under the issuer when clientRegistrationEnabled is true', () => {
    const withRegistration = discoveryDocument({
      issuer: 'https://idp.example/realms/acme',
      claimsSupported: CLAIMS_SUPPORTED,
      scopesSupported: SCOPES_SUPPORTED,
      clientRegistrationEnabled: true,
    });
    expect(withRegistration.registration_endpoint).toBe(
      'https://idp.example/realms/acme/clients-registrations/openid-connect',
    );
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
  // never empty; claims_supported and scopes_supported are the two passed
  // in, so their emptiness is the only kind reachable from outside.
  it('is omitted rather than published empty when the supplied list is empty', () => {
    const empty = discoveryDocument({
      issuer: 'https://idp.example/realms/acme',
      claimsSupported: [],
      scopesSupported: [],
    });
    for (const member of ['claims_supported', 'scopes_supported']) {
      expect(Object.keys(empty)).not.toContain(member);
      expect(JSON.stringify(empty)).not.toContain(member);
    }
  });

  // A realm whose client_registration_policy is 'disabled' — what `doc`
  // above represents, since no clientRegistrationEnabled option was passed
  // — leaves the member out altogether rather than published as null or an
  // empty string. `[OIDC-DISCOVERY-3-01]` above covers the opposite case.
  it('leaves registration_endpoint out of the document entirely for a realm that has not opened it', () => {
    expect(Object.keys(doc)).not.toContain('registration_endpoint');
  });
});

describe('[RFC9207-2.3-01] the issuer identifier a client validates `iss` against', () => {
  it('is published in the metadata, so the `iss` parameter has a value to be compared to', () => {
    expect(doc.issuer).toBe('https://idp.example/realms/acme');
    expect(new URL(doc.issuer).protocol).toBe('https:');
  });
});

describe('[RFC9207-2.3-02] support for the `iss` authorization-response parameter', () => {
  it('is declared true in the metadata', () => {
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe('[RFC6749-3.1-03] the advertised authorization endpoint URI', () => {
  it('carries no fragment component', () => {
    expect(doc.authorization_endpoint).not.toContain('#');
    expect(new URL(doc.authorization_endpoint).hash).toBe('');
  });
});
