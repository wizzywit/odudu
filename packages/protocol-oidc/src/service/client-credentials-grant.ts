import { type ClientRecord } from '@odudu/domain-realm';

export interface ClientCredentialsGrantRequest {
  requestedScope: string;
}

// `not_confidential` and `no_service_subject` both report unauthorized_client
// at the boundary — this client cannot use this grant, full stop — while
// `scope_widened` is invalid_scope. The usecase does that mapping, not this
// function.
export type ClientCredentialsGrantDecision =
  | { readonly ok: true; readonly scope: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: 'not_confidential' | 'no_service_subject' | 'scope_widened';
    };

// Stage 3's grant-specific rules for `client_credentials`, pure: no
// queries, no I/O. There is no PKCE, no redirect_uri and no user here —
// the only pairing to validate is this client against its own configured
// allowlist. A public client has no secret, so there is nothing to
// authenticate and granting it would let anyone who knows the client_id
// mint tokens; a confidential client with no service_subject_id has never
// been provisioned for this grant, regardless of what `grant_types` claims.
export function evaluateClientCredentialsGrant(
  client: ClientRecord,
  allowedScopes: readonly string[],
  request: ClientCredentialsGrantRequest,
): ClientCredentialsGrantDecision {
  if (client.type !== 'confidential') return { ok: false, reason: 'not_confidential' };
  if (client.serviceSubjectId === null) return { ok: false, reason: 'no_service_subject' };

  const requestedTokens = request.requestedScope.split(' ').filter((token) => token.length > 0);
  const allowedSet = new Set(allowedScopes);
  const widened = requestedTokens.some((token) => !allowedSet.has(token));
  if (widened) return { ok: false, reason: 'scope_widened' };

  return { ok: true, scope: requestedTokens };
}
