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
  readonly authorization_response_iss_parameter_supported: boolean;
  readonly scopes_supported: readonly string[];
  readonly claims_supported: readonly string[];
}

export interface DiscoveryDocumentOptions {
  readonly issuer: string;
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
    authorization_response_iss_parameter_supported: true,
    scopes_supported: SUPPORTED_SCOPES,
    claims_supported: ['sub'],
  };
}
