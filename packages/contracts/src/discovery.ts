import { TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED } from '#/token';

// authenticateClient (packages/protocol-oidc/src/usecase/client-authentication.ts)
// is what both /introspect and /revoke authenticate through, and it accepts
// a Basic header, a body client_secret, or — verifyClientSecret,
// packages/domain-tenant/src/service/client.ts — no secret at all from a
// `none` public client. Only private_key_jwt and tls_client_auth are never
// dispatched here, so unlike the token endpoint's list this one never
// varies with ODUDU_TRUST_PROXY.
const INTROSPECTION_AND_REVOCATION_AUTH_METHODS_SUPPORTED = [
  'client_secret_basic',
  'client_secret_post',
  'none',
] as const;

// Every `_endpoint` member is served unconditionally once a realm is
// provisioned, including the three their own specifications make OPTIONAL:
// `introspection_endpoint`, `revocation_endpoint` and
// `end_session_endpoint`. `registration_endpoint` is the one exception.
export interface DiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly introspection_endpoint: string;
  readonly revocation_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint: string;
  readonly response_types_supported: readonly string[];
  readonly response_modes_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
  // OIDC Discovery §3. The signing list is this realm's own active key's
  // algorithm plus `none`; the encryption lists are the same for every realm.
  readonly userinfo_signing_alg_values_supported: readonly string[];
  readonly userinfo_encryption_alg_values_supported: readonly string[];
  readonly userinfo_encryption_enc_values_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly introspection_endpoint_auth_methods_supported: readonly string[];
  readonly revocation_endpoint_auth_methods_supported: readonly string[];
  readonly authorization_response_iss_parameter_supported: boolean;
  readonly claims_parameter_supported: boolean;
  // Fixed true: a client opts into logout per client, not per realm, and
  // `sid` always travels in the logout token and in the front-channel
  // redirect of a client that registered `..._session_required`.
  readonly backchannel_logout_supported: boolean;
  readonly backchannel_logout_session_supported: boolean;
  readonly frontchannel_logout_supported: boolean;
  readonly frontchannel_logout_session_supported: boolean;
  // OIDC Discovery §4.2 omits a zero-element claim rather than serving [].
  // Every other list here is a non-empty literal.
  readonly scopes_supported?: readonly string[];
  readonly claims_supported?: readonly string[];
  // RFC 7591 §3.1: absent while the realm's client_registration_policy is
  // 'disabled', since advertising it then claims a capability that 404s.
  readonly registration_endpoint?: string;
}

export interface DiscoveryDocumentOptions {
  readonly issuer: string;
  // Passed in rather than defaulted: both are realm data and this package is
  // a leaf that never reads a database. The caller hands the same lists to
  // /authorize and to the claim mapper registry, which is what stops drift.
  readonly claimsSupported: readonly string[];
  readonly scopesSupported: readonly string[];
  // The realm's active key's algorithm plus `none`.
  readonly userinfoSigningAlgSupported: readonly string[];
  // Fixed by the installed jose, not by any realm's own data.
  readonly userinfoEncryptionAlgSupported: readonly string[];
  readonly userinfoEncryptionEncSupported: readonly string[];
  // The path is fixed here, so the caller states existence, never a URL.
  readonly clientRegistrationEnabled?: boolean;
  // Whether `ODUDU_TRUST_PROXY` is on. Unset means `tls_client_auth` is
  // unavailable, so it must not be advertised either
  // (docs/superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md:596-598).
  readonly tlsClientAuthEnabled?: boolean;
}

export function discoveryDocument(opts: DiscoveryDocumentOptions): DiscoveryDocument {
  // OIDC Discovery §4.1: trimming the terminating "/" is what makes this
  // issuer the string a client re-derives from the URL it fetched.
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
    // Fixed, not configurable: OAuth 2.1 drops implicit and hybrid, so a
    // client that trusts discovery cannot be offered a weaker flow.
    response_types_supported: ['code'],
    // Stated rather than left to its default, which OIDC Discovery §3 makes
    // ["query", "fragment"] — and /authorize refuses `fragment`.
    response_modes_supported: ['query'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    userinfo_signing_alg_values_supported: opts.userinfoSigningAlgSupported,
    userinfo_encryption_alg_values_supported: opts.userinfoEncryptionAlgSupported,
    userinfo_encryption_enc_values_supported: opts.userinfoEncryptionEncSupported,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    // Built from the same constant `authenticateClient` validates against, so
    // discovery cannot advertise a method the token endpoint would reject.
    token_endpoint_auth_methods_supported:
      opts.tlsClientAuthEnabled === true
        ? TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED
        : TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED.filter((method) => method !== 'tls_client_auth'),
    introspection_endpoint_auth_methods_supported:
      INTROSPECTION_AND_REVOCATION_AUTH_METHODS_SUPPORTED,
    revocation_endpoint_auth_methods_supported: INTROSPECTION_AND_REVOCATION_AUTH_METHODS_SUPPORTED,
    authorization_response_iss_parameter_supported: true,
    claims_parameter_supported: true,
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
