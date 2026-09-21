import { z } from 'zod';
import { assertFetchableUrl, RemoteAddressRefused } from '#/service/remote-address';

// The RFC 7591 §3.2.2 error codes this validator returns. `error` doubles
// as the wire value of the registration error response's `error` member.
type ClientMetadataError = 'invalid_redirect_uri' | 'invalid_client_metadata';

export interface ClientMetadata {
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  clientName: string | null;
  jwks: unknown;
  jwksUri: string | null;
  frontchannelLogoutUri: string | null;
  backchannelLogoutUri: string | null;
  backchannelLogoutSessionRequired: boolean;
  frontchannelLogoutSessionRequired: boolean;
  userinfoSignedResponseAlg: string | null;
  userinfoEncryptedResponseAlg: string | null;
  userinfoEncryptedResponseEnc: string | null;
  tlsClientAuthSubjectDn: string | null;
}

export type ClientMetadataOutcome =
  | { kind: 'ok'; metadata: ClientMetadata }
  | { kind: 'invalid'; error: ClientMetadataError; description: string };

function invalid(error: ClientMetadataError, description: string): ClientMetadataOutcome {
  return { kind: 'invalid', error, description };
}

// client_oidc_config_grant_types_check (migration 0007_client_oidc_config.sql).
const GRANT_TYPES_PERMITTED = new Set([
  'authorization_code',
  'refresh_token',
  'client_credentials',
]);

// client_oidc_config_auth_method_check (migration 0045_client_registration_metadata.sql).
const AUTH_METHODS_PERMITTED = new Set([
  'client_secret_basic',
  'client_secret_post',
  'none',
  'private_key_jwt',
  'tls_client_auth',
]);

// RFC 7591 §2: the server assigns these, so a client stating one for itself
// is refused rather than silently overridden — silent override is how a
// client comes to believe it chose its own identity.
const SERVER_ASSIGNED_FIELDS = [
  'client_id',
  'client_secret',
  'registration_access_token',
  'registration_client_uri',
] as const;

function isLoopbackHost(hostname: string): boolean {
  // RFC 8252 §8.3 prefers the literal forms over `localhost`, whose
  // resolution is under the resolver's control — accepted here all the
  // same because nothing in RFC 7591 §5 forbids the weaker form.
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost';
}

// RFC 7591 §5's third bullet is "a non-HTTP application-specific URL", not
// any scheme a client names — `javascript:`, `data:` and `file:` would
// otherwise all pass as a bare "carries its own scheme-specific part".
// RFC 8252 §7.1's reverse-DNS convention (`com.example.app:/cb`) is what a
// private-use scheme actually looks like, and no dangerous scheme carries a
// '.' in its own name, so requiring one closes the class without an
// enumerable — and inevitably incomplete — denylist.
function isCustomUriScheme(scheme: string): boolean {
  return scheme.includes('.');
}

// RFC 7591 §5 MUST: an https URI to any host, an http URI to loopback only,
// or a non-HTTP application-specific URL carrying its own scheme-specific
// part. A fragment is refused for every form — RFC 6749 §3.1.2 redirect
// URIs never carry one.
function isValidRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash !== '') return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname);
  const scheme = url.protocol.slice(0, -1);
  return (
    isCustomUriScheme(scheme) && (url.pathname !== '' || url.search !== '' || url.hostname !== '')
  );
}

// Registration-time policy for both logout URIs (OIDC Back-Channel Logout
// 1.0 §2.2, Front-Channel Logout 1.0 §2's own registration metadata): https,
// absolute, no fragment. Unlike the redirect_uri MAY, no exception is made
// for a confidential client's http URI — see docs/protocols/oidc-backchannel.md.
function isValidLogoutUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hash === '';
}

// Front-Channel Logout 1.0 §2: the front-channel logout URI's domain, port
// and scheme must match a registered redirect URI's. `URL#origin` folds a
// default port into its scheme-standard form (`https://a` and
// `https://a:443` both yield `https://a`), so comparing origins rather than
// raw strings treats those as the same value the specification does.
function sharesOriginWithRegisteredRedirectUri(
  frontchannelLogoutUri: string,
  redirectUris: readonly string[],
): boolean {
  const target = new URL(frontchannelLogoutUri).origin;
  return redirectUris.some((redirectUri) => {
    try {
      return new URL(redirectUri).origin === target;
    } catch {
      return false;
    }
  });
}

const jwkSetShape = z.object({ keys: z.array(z.unknown()) });

const metadataShape = z.object({
  redirect_uris: z.array(z.string()).optional(),
  grant_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  client_name: z.string().optional(),
  jwks: jwkSetShape.optional(),
  jwks_uri: z.string().optional(),
  frontchannel_logout_uri: z.string().optional(),
  backchannel_logout_uri: z.string().optional(),
  backchannel_logout_session_required: z.boolean().optional(),
  frontchannel_logout_session_required: z.boolean().optional(),
  userinfo_signed_response_alg: z.string().optional(),
  userinfo_encrypted_response_alg: z.string().optional(),
  userinfo_encrypted_response_enc: z.string().optional(),
  tls_client_auth_subject_dn: z.string().optional(),
});

// The registration body is an untyped boundary: parsed with Zod, never
// cast. Business rules (server-assigned fields, grant/method allowlists,
// jwks exclusivity, URI shape) run after the shape is known to be sound.
export function parseClientMetadata(
  body: unknown,
  options: { tlsClientAuthEnabled: boolean },
): ClientMetadataOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid('invalid_client_metadata', 'registration body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;

  const assigned = SERVER_ASSIGNED_FIELDS.find((field) => field in raw);
  if (assigned !== undefined) {
    return invalid('invalid_client_metadata', `${assigned} is assigned by the server`);
  }

  const shape = metadataShape.safeParse(raw);
  if (!shape.success) {
    return invalid(
      'invalid_client_metadata',
      shape.error.issues[0]?.message ?? 'malformed client metadata',
    );
  }
  const metadata = shape.data;

  const grantTypes = metadata.grant_types ?? ['authorization_code'];
  const unknownGrant = grantTypes.find((grant) => !GRANT_TYPES_PERMITTED.has(grant));
  if (unknownGrant !== undefined) {
    return invalid('invalid_client_metadata', `grant_types must not include ${unknownGrant}`);
  }

  const tokenEndpointAuthMethod = metadata.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!AUTH_METHODS_PERMITTED.has(tokenEndpointAuthMethod)) {
    return invalid(
      'invalid_client_metadata',
      `token_endpoint_auth_method must not be ${tokenEndpointAuthMethod}`,
    );
  }
  // docs/superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md:596-598:
  // "unset means the method is unavailable and a client registering
  // tls_client_auth is refused" — a registration nobody could ever
  // authenticate with is worse than none, since it looks configured.
  if (tokenEndpointAuthMethod === 'tls_client_auth' && !options.tlsClientAuthEnabled) {
    return invalid(
      'invalid_client_metadata',
      'tls_client_auth is unavailable: ODUDU_TRUST_PROXY is off on this deployment',
    );
  }

  // client_oidc_config_tls_client_auth_needs_subject_dn (migration
  // 0055_client_tls_client_auth_subject_dn.sql): the column the token
  // endpoint compares a proxy-supplied certificate subject against, so a
  // tls_client_auth registration with nothing in it would authenticate
  // against nothing. RFC 8705 §2.1.2. Stored only for that method — a
  // value sent alongside any other one is dropped, not kept dormant, so a
  // `client_secret_basic` row can never carry a subject a certificate
  // could later be checked against.
  const providedSubjectDn = metadata.tls_client_auth_subject_dn?.trim() ?? '';
  if (tokenEndpointAuthMethod === 'tls_client_auth' && providedSubjectDn.length === 0) {
    return invalid(
      'invalid_client_metadata',
      'tls_client_auth_subject_dn is required when token_endpoint_auth_method is tls_client_auth',
    );
  }
  const tlsClientAuthSubjectDn =
    tokenEndpointAuthMethod === 'tls_client_auth' ? providedSubjectDn : '';

  const redirectUris = metadata.redirect_uris ?? [];
  const badRedirectUri = redirectUris.find((uri) => !isValidRedirectUri(uri));
  if (badRedirectUri !== undefined) {
    return invalid('invalid_redirect_uri', `redirect_uris entry ${badRedirectUri} is not valid`);
  }
  // client_oidc_config_redirect_uris_present: exact array equality, not
  // "contains" — adding refresh_token still needs an interactive grant to
  // originate the refresh token from, so it still needs a redirect_uri.
  const needsRedirectUri = !(grantTypes.length === 1 && grantTypes[0] === 'client_credentials');
  if (redirectUris.length === 0 && needsRedirectUri) {
    return invalid(
      'invalid_redirect_uri',
      'redirect_uris is required unless grant_types is exactly ["client_credentials"]',
    );
  }

  if (metadata.jwks !== undefined && metadata.jwks_uri !== undefined) {
    return invalid('invalid_client_metadata', 'jwks and jwks_uri are mutually exclusive');
  }

  let jwksUri: string | null = null;
  if (metadata.jwks_uri !== undefined) {
    try {
      assertFetchableUrl(metadata.jwks_uri);
      jwksUri = metadata.jwks_uri;
    } catch (error) {
      if (!(error instanceof RemoteAddressRefused)) throw error;
      return invalid('invalid_client_metadata', `jwks_uri: ${error.reason}`);
    }
  }

  if (
    metadata.backchannel_logout_uri !== undefined &&
    !isValidLogoutUri(metadata.backchannel_logout_uri)
  ) {
    return invalid(
      'invalid_client_metadata',
      'backchannel_logout_uri must be an absolute https URI with no fragment',
    );
  }

  if (metadata.frontchannel_logout_uri !== undefined) {
    if (!isValidLogoutUri(metadata.frontchannel_logout_uri)) {
      return invalid(
        'invalid_client_metadata',
        'frontchannel_logout_uri must be an absolute https URI with no fragment',
      );
    }
    if (!sharesOriginWithRegisteredRedirectUri(metadata.frontchannel_logout_uri, redirectUris)) {
      return invalid(
        'invalid_client_metadata',
        'frontchannel_logout_uri must share its domain, port and scheme with a registered redirect_uri',
      );
    }
  }

  return {
    kind: 'ok',
    metadata: {
      redirectUris,
      grantTypes,
      tokenEndpointAuthMethod,
      clientName: metadata.client_name ?? null,
      jwks: metadata.jwks ?? null,
      jwksUri,
      frontchannelLogoutUri: metadata.frontchannel_logout_uri ?? null,
      backchannelLogoutUri: metadata.backchannel_logout_uri ?? null,
      backchannelLogoutSessionRequired: metadata.backchannel_logout_session_required ?? false,
      frontchannelLogoutSessionRequired: metadata.frontchannel_logout_session_required ?? false,
      userinfoSignedResponseAlg: metadata.userinfo_signed_response_alg ?? null,
      userinfoEncryptedResponseAlg: metadata.userinfo_encrypted_response_alg ?? null,
      userinfoEncryptedResponseEnc: metadata.userinfo_encrypted_response_enc ?? null,
      tlsClientAuthSubjectDn: tlsClientAuthSubjectDn.length > 0 ? tlsClientAuthSubjectDn : null,
    },
  };
}
