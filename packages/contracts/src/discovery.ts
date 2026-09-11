import { TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED } from '#/token';

export interface DiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly jwks_uri: string;
  readonly response_types_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly authorization_response_iss_parameter_supported: boolean;
  readonly scopes_supported: readonly string[];
  readonly claims_supported: readonly string[];
}

export interface DiscoveryDocumentOptions {
  readonly issuer: string;
  // Required, not defaulted: the set of claims Odudu can actually return is
  // owned by protocol-oidc's claim mapper registry, not by this package, so
  // there is no honest default here to fall back to. Passing it through
  // rather than hardcoding it is what keeps this list from drifting away
  // from what `/userinfo` and ID token issuance actually produce.
  readonly claimsSupported: readonly string[];
}

// The one list of scopes Odudu accepts, shared with authorize-validation.ts
// so the two cannot drift apart — discovery advertises exactly what
// /authorize will accept, never more, never less.
export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const;

// registration_endpoint is omitted entirely (not published empty or null):
// dynamic client registration is P3's work (docs/protocols/oidc-discovery.md).
export function discoveryDocument(opts: DiscoveryDocumentOptions): DiscoveryDocument {
  // OIDC Discovery §4.1: a terminating "/" on the issuer is removed before
  // appending "/.well-known/openid-configuration" — applied here so the
  // issuer this document names is always the same string a client re-derives
  // by trimming the well-known suffix off the URL it fetched.
  const issuer = opts.issuer.replace(/\/+$/, '');

  return {
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
    jwks_uri: `${issuer}/protocol/openid-connect/certs`,
    // Fixed, not configurable: OAuth 2.1 drops implicit and hybrid, PKCE is
    // mandatory with S256 only, and P1 implements exactly these three grant
    // types. A client that reads discovery and trusts it cannot be offered a
    // weaker flow.
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    // Built from the same constant `authenticateClient` validates against
    // (@odudu/contracts' token.ts), so discovery can never advertise a
    // method the token endpoint would actually reject.
    token_endpoint_auth_methods_supported: TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: SUPPORTED_SCOPES,
    claims_supported: opts.claimsSupported,
  };
}
