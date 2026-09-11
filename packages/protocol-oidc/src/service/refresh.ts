import { createHash, randomBytes } from 'node:crypto';
import { type SubjectRecord } from '@odudu/domain-identity';
import { type ClientRecord } from '@odudu/domain-realm';
import { type TokenGrantRecord } from '#/schema/token-grants';

// 32 random bytes, base64url-encoded: same shape and entropy budget as
// generateAuthorizationCode, for the same reason — RFC 6749 §10.10 wants a
// value that cannot be guessed.
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// Not a slow/comparison-safe hash, for the same reason
// hashAuthorizationCode isn't: the input already carries 256 bits of
// entropy, so this exists only to keep the raw token out of storage.
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export interface RefreshGrantRequest {
  requestedScope: string;
}

// Every reason this can fail maps to a different error at the boundary:
// `scope_widened` is `invalid_scope`, everything else is `invalid_grant` —
// unlike the authorization_code grant, where every reason collapses to the
// same code. The usecase, not this function, does that mapping.
export type RefreshGrantDecision =
  | { readonly ok: true; readonly scope: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: 'client_mismatch' | 'grant_revoked' | 'subject_disabled' | 'scope_widened';
    };

// Stage 3's grant-specific rules for `refresh_token`, pure: no queries, no
// I/O. `grant` and `subject` are already loaded by the usecase from the
// record the atomic rotation returned; this only decides whether that
// already-rotated pairing may proceed. Order matters for the same reason it
// does in evaluateAuthorizationCodeGrant: a wrong client must never be
// reported as a scope failure.
export function evaluateRefreshGrant(
  grant: TokenGrantRecord,
  client: ClientRecord,
  subject: SubjectRecord,
  request: RefreshGrantRequest,
): RefreshGrantDecision {
  if (grant.clientId !== client.id) return { ok: false, reason: 'client_mismatch' };
  if (grant.revokedAt !== null) return { ok: false, reason: 'grant_revoked' };
  if (subject.disabledAt !== null) return { ok: false, reason: 'subject_disabled' };

  const grantedTokens = grant.scope.split(' ').filter((token) => token.length > 0);
  const requestedTokens =
    request.requestedScope.trim().length > 0
      ? request.requestedScope.split(' ').filter((token) => token.length > 0)
      : grantedTokens;

  const grantedSet = new Set(grantedTokens);
  const widened = requestedTokens.some((token) => !grantedSet.has(token));
  if (widened) return { ok: false, reason: 'scope_widened' };

  return { ok: true, scope: requestedTokens };
}
