import { type ClientRecord } from '@odudu/domain-realm';
import { type AuthorizationCodeRecord } from '#/schema/authorization-codes';
import { verifyPkce } from '#/service/pkce';

export interface AuthorizationCodeGrantRequest {
  redirectUri: string;
  codeVerifier: string;
}

// `reason` distinguishes the three ways this grant's own rules can fail —
// useful to this file's own tests, and to whatever the next grant needs
// while composing its own decision — but the usecase collapses every one of
// them to the same invalid_grant: RFC 6749 §5.2 forbids the response from
// being an oracle over which check actually failed.
export type AuthorizationCodeGrantDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'client_mismatch' | 'redirect_uri_mismatch' | 'pkce_mismatch';
    };

// Stage 3's grant-specific rules, pure: no queries, no I/O. `record` is the
// code already consumed by the atomic UPDATE, `client` the client already
// authenticated — this only decides whether that particular pairing may
// proceed. Order matters for one reason only: a wrong client or redirect_uri
// must never be reported as a PKCE failure by a caller inspecting `reason`,
// so client and redirect_uri are checked first.
export function evaluateAuthorizationCodeGrant(
  record: AuthorizationCodeRecord,
  client: ClientRecord,
  request: AuthorizationCodeGrantRequest,
): AuthorizationCodeGrantDecision {
  if (record.clientId !== client.id) return { ok: false, reason: 'client_mismatch' };
  if (record.redirectUri !== request.redirectUri) {
    return { ok: false, reason: 'redirect_uri_mismatch' };
  }
  if (!verifyPkce(request.codeVerifier, record.codeChallenge, record.codeChallengeMethod)) {
    return { ok: false, reason: 'pkce_mismatch' };
  }
  return { ok: true };
}
