import { type PendingRequest } from '@odudu/authn-flows';
import { type ClientRecord } from '@odudu/domain-realm';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';
import { isRegisteredRedirectUri } from '#/service/redirect-uri';

export type AuthorizeOutcome =
  | { kind: 'ok'; request: PendingRequest }
  | { kind: 'render'; error: string; description: string }
  | { kind: 'redirect'; redirectUri: string; error: string; state: string | null };

// P1 publishes exactly one scope in discovery (scopes_supported: ['openid']);
// anything else is unknown rather than silently ignored, so a client relying
// on a scope Odudu does not grant finds out at request time, not later.
const KNOWN_SCOPES = new Set(['openid']);

function scopesAreKnown(scope: string | undefined): boolean {
  const tokens = (scope ?? 'openid').split(' ').filter((token) => token.length > 0);
  return tokens.length > 0 && tokens.every((token) => KNOWN_SCOPES.has(token));
}

function toPendingRequest(
  client: ClientRecord,
  params: Record<string, string | undefined>,
  redirectUri: string,
  state: string | null,
  codeChallenge: string,
): PendingRequest {
  return {
    clientId: client.clientId,
    redirectUri,
    scope: params.scope ?? 'openid',
    state,
    nonce: params.nonce ?? null,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

export function validateAuthorizationRequest(
  params: Record<string, string | undefined>,
  client: ClientRecord | null,
  config: ClientOidcConfig | null,
  // Set when normalizeAuthorizeQuery collapsed a repeated query parameter
  // other than client_id/redirect_uri (those render before reaching here —
  // see query-normalization.ts). Checked immediately below the boundary,
  // ahead of every other below-boundary rule.
  repeatedKey: string | null = null,
): AuthorizeOutcome {
  // Order is the contract. Everything above the redirect boundary reports by
  // rendering: until redirect_uri is known to belong to a real, enabled
  // client, sending the user there is an open redirect wearing this server's
  // domain. RFC 6749 §4.1.2.1 says MUST NOT automatically redirect.
  if (!client || !client.enabled || !config) {
    return { kind: 'render', error: 'invalid_client', description: 'Unknown or disabled client' };
  }

  const redirectUri = params.redirect_uri;
  if (redirectUri === undefined || !isRegisteredRedirectUri(redirectUri, config.redirectUris)) {
    return { kind: 'render', error: 'invalid_request', description: 'Unregistered redirect URI' };
  }

  // Below the boundary: redirect_uri is trusted, so errors go back to it.
  const state = params.state ?? null;
  const reject = (error: string): AuthorizeOutcome => ({
    kind: 'redirect',
    redirectUri,
    error,
    state,
  });

  if (repeatedKey !== null) return reject('invalid_request');

  if (params.response_type !== 'code') return reject('unsupported_response_type');

  const codeChallenge = params.code_challenge;
  if (codeChallenge === undefined || codeChallenge.length === 0) {
    return reject('invalid_request');
  }
  if (params.code_challenge_method !== 'S256') return reject('invalid_request');
  if (!scopesAreKnown(params.scope)) return reject('invalid_scope');

  return {
    kind: 'ok',
    request: toPendingRequest(client, params, redirectUri, state, codeChallenge),
  };
}
