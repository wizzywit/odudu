import { TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED } from '#/token';

export interface DiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  // RFC 8414 §2's own discovery member for the endpoint RFC 7662 §2
  // defines; always served once a realm is provisioned, the same way
  // `end_session_endpoint` below is.
  readonly introspection_endpoint: string;
  // RFC 8414 §2's own discovery member for the endpoint RFC 7009 §2
  // defines; always served once a realm is provisioned, the same way
  // `introspection_endpoint` above is.
  readonly revocation_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly jwks_uri: string;
  // OpenID Connect RP-Initiated Logout 1.0 §4's own discovery member —
  // OPTIONAL there, but Odudu always serves the endpoint once a realm is
  // provisioned, the same way `authorization_response_iss_parameter_supported`
  // (RFC 9207) and `code_challenge_methods_supported` (RFC 7636) are
  // extension members this document already always states.
  readonly end_session_endpoint: string;
  readonly response_types_supported: readonly string[];
  readonly response_modes_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
  // OIDC Discovery §3: the JWS `alg` values a client may register in
  // `userinfo_signed_response_alg` — this realm's own active key's algorithm.
  readonly userinfo_signing_alg_values_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly authorization_response_iss_parameter_supported: boolean;
  // Back-Channel Logout 1.0 §2.1 and Front-Channel Logout 1.0 §2: fixed
  // true, like `end_session_endpoint` above, since a client opts in per
  // client rather than per realm. `_session_supported` is true for both:
  // `sid` always travels in the logout token and in the front-channel
  // redirect when the client registered `..._session_required`.
  readonly backchannel_logout_supported: boolean;
  readonly backchannel_logout_session_supported: boolean;
  readonly frontchannel_logout_supported: boolean;
  readonly frontchannel_logout_session_supported: boolean;
  // Both optional because OIDC Discovery §4.2 requires a claim with zero
  // elements to be omitted rather than served as []; every other list here
  // is built from a non-empty literal, so these two — the ones supplied by
  // the caller — are the only members that can be absent.
  readonly scopes_supported?: readonly string[];
  readonly claims_supported?: readonly string[];
  // RFC 7591 §3.1: present only when the realm's client_registration_policy
  // is not 'disabled' — advertising it otherwise would claim a capability
  // that answers 404.
  readonly registration_endpoint?: string;
}

export interface DiscoveryDocumentOptions {
  readonly issuer: string;
  // Required, not defaulted: the set of claims Odudu can actually return is
  // owned by protocol-oidc's claim mapper registry, not by this package, so
  // there is no honest default here to fall back to. Passing it through
  // rather than hardcoding it is what keeps this list from drifting away
  // from what `/userinfo` and ID token issuance actually produce.
  readonly claimsSupported: readonly string[];
  // The scopes the realm this document describes defines. Passed in for the
  // same reason claimsSupported is: a scope is realm data, and this package
  // is a leaf that never reads a database. The caller hands the same list to
  // /authorize's validation, so the two cannot drift apart.
  readonly scopesSupported: readonly string[];
  // What `userinfo_signed_response_alg` this realm can actually honour:
  // its active key's algorithm, plus `none` (OIDC Discovery §3).
  readonly userinfoSigningAlgSupported: readonly string[];
  // Whether the realm's client_registration_policy is not 'disabled' — the
  // endpoint's path is fixed the same way every other one here is, so the
  // caller states only whether it exists, never its URL.
  readonly clientRegistrationEnabled?: boolean;
  // Whether this deployment's `ODUDU_TRUST_PROXY` is on — the design
  // decision `tls_client_auth` was recorded under
  // (docs/superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md:596-598):
  // unset means the method is unavailable, so it must not be advertised
  // either. Defaults false, the same as the flag itself does.
  readonly tlsClientAuthEnabled?: boolean;
}

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
    introspection_endpoint: `${issuer}/protocol/openid-connect/token/introspect`,
    revocation_endpoint: `${issuer}/protocol/openid-connect/revoke`,
    userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
    jwks_uri: `${issuer}/protocol/openid-connect/certs`,
    end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
    // Fixed, not configurable: OAuth 2.1 drops implicit and hybrid, PKCE is
    // mandatory with S256 only, and P1 implements exactly these three grant
    // types. A client that reads discovery and trusts it cannot be offered a
    // weaker flow.
    response_types_supported: ['code'],
    // Stated rather than left to its default: OIDC Discovery §3 defaults an
    // omitted response_modes_supported to ["query", "fragment"], and
    // /authorize refuses `fragment` (OIDC Core §3.1.2.6).
    response_modes_supported: ['query'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    userinfo_signing_alg_values_supported: opts.userinfoSigningAlgSupported,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    // Built from the same constant `authenticateClient` validates against
    // (@odudu/contracts' token.ts), so discovery can never advertise a
    // method the token endpoint would actually reject — `tls_client_auth`
    // filtered out unless this deployment can actually honour it
    // (`tlsClientAuthEnabled` above), the same way `registration_endpoint`
    // below is only ever named when the realm can actually serve it.
    token_endpoint_auth_methods_supported:
      opts.tlsClientAuthEnabled === true
        ? TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED
        : TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED.filter((method) => method !== 'tls_client_auth'),
    authorization_response_iss_parameter_supported: true,
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    frontchannel_logout_supported: true,
    frontchannel_logout_session_supported: true,
    ...(opts.scopesSupported.length > 0 ? { scopes_supported: opts.scopesSupported } : {}),
    ...(opts.claimsSupported.length > 0 ? { claims_supported: opts.claimsSupported } : {}),
    ...(opts.clientRegistrationEnabled === true
      ? { registration_endpoint: `${issuer}/clients-registrations/openid-connect` }
      : {}),
  };
}
