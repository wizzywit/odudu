import { type PendingRequest } from '@odudu/authn-flows';
import { SUPPORTED_SCOPES } from '@odudu/contracts';
import { type ClientRecord } from '@odudu/domain-realm';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';
import { isWellFormedPkceString } from '#/service/pkce';
import { parsePrompt, type PromptValue } from '#/service/prompt';
import { isRegisteredRedirectUri } from '#/service/redirect-uri';

export type AuthorizeOutcome =
  | {
      kind: 'ok';
      request: PendingRequest;
      // What the request asks about interacting with the End-User, and the
      // hint naming who the End-User is meant to be. Both are answered after
      // this function returns — `none` by refusing to authenticate anybody,
      // the hint by a signature check against the realm's own keys — because
      // neither is decidable from the request parameters alone.
      prompts: ReadonlySet<PromptValue>;
      idTokenHint: string | null;
    }
  | { kind: 'render'; error: string; description: string }
  | { kind: 'redirect'; redirectUri: string; error: string; state: string | null };

// The same list discovery.ts advertises as scopes_supported, imported
// rather than duplicated so the two cannot drift apart. profile and email
// are accepted here so the claim mappers gated on them have a token to
// attach claims to; claims_supported stays at just `sub` until those
// mappers exist, since advertising a claim nothing yet returns would be
// the same dishonesty in the other direction.
const KNOWN_SCOPES = new Set<string>(SUPPORTED_SCOPES);

// The only Response Mode Odudu answers in, and the default one for
// `response_type=code` (OIDC Core §3.1.2.1). `fragment` and `form_post`
// deliver the response by means this server does not implement, so a
// client asking for either is told, not quietly answered in another mode.
// Discovery advertises this same list as response_modes_supported —
// omitting the member would default it to ["query", "fragment"]
// (OIDC Discovery §3) and promise what this rejects.
const SUPPORTED_RESPONSE_MODE = 'query';

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
  //
  // The Response Mode comes first of all, and reports by rendering whatever
  // else is wrong with the request: it names how the response is to be
  // delivered, so an unsupported one leaves no way to deliver an error
  // either. OIDC Core §3.1.2.6 asks for an HTTP 400 carrying no error
  // response parameters, which is what rendering is.
  const responseMode = params.response_mode;
  if (responseMode !== undefined && responseMode !== SUPPORTED_RESPONSE_MODE) {
    return {
      kind: 'render',
      error: 'invalid_request',
      description: `Unsupported response_mode; this server answers in ${SUPPORTED_RESPONSE_MODE} only`,
    };
  }

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

  // OIDC Core §3.1.2.6: request objects (§6) are not implemented, and the
  // specification requires saying so. Silently dropping the parameter would
  // leave the client believing the parameters it signed were the ones
  // honoured, when the ones honoured are whatever the query string carried.
  if (params.request !== undefined) return reject('request_not_supported');
  if (params.request_uri !== undefined) return reject('request_uri_not_supported');

  if (params.response_type !== 'code') return reject('unsupported_response_type');

  const codeChallenge = params.code_challenge;
  if (codeChallenge === undefined || !isWellFormedPkceString(codeChallenge)) {
    return reject('invalid_request');
  }
  if (params.code_challenge_method !== 'S256') return reject('invalid_request');
  if (!scopesAreKnown(params.scope)) return reject('invalid_scope');

  // `prompt` is a request parameter like any other, so a malformed one is
  // refused here rather than acted on later: `none` alongside another value
  // (OIDC Core §3.1.2.1), or a value outside the four the specification
  // defines — the MAY that §3.1.2.1 grants, taken because a client asking
  // for something this server has never heard of is better told so than
  // answered as if it had asked for nothing.
  const prompt = parsePrompt(params.prompt);
  if (prompt.kind === 'invalid') return reject('invalid_request');

  return {
    kind: 'ok',
    request: toPendingRequest(client, params, redirectUri, state, codeChallenge),
    prompts: prompt.values,
    idTokenHint: params.id_token_hint ?? null,
  };
}
