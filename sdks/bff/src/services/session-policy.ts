import { OduduError } from '@odudu-io/oidc';
import type { TokenSet } from '@odudu-io/oidc';

export const REFRESH_SKEW_MS = 30_000;
export const LOGIN_TTL_MS = 10 * 60 * 1000;
// How long a store keeps the lock taken for one refresh if it is never released.
export const REFRESH_LOCK_TTL_MS = 30_000;

// Another instance holds the session's refresh lock and the session still needs
// the refresh it is making; nothing is wrong with the grant.
export class RefreshBusyError extends Error {
  constructor() {
    super('the session is being refreshed by another instance');
    this.name = 'RefreshBusyError';
  }
}

// An access token about to expire is renewed, when there is a refresh token to
// renew it with. The soonest expiry counts: every audience is renewed together.
export function needsRefresh(tokens: TokenSet, now: number): boolean {
  if (tokens.refreshToken === undefined) return false;
  const expiries = Object.values(tokens.byAudience).map((token) => token.expiresAt);
  return expiries.length > 0 && Math.min(...expiries) - now <= REFRESH_SKEW_MS;
}

// A session whose tokens ran out with no refresh token to renew them is over.
export function isExpiredForGood(tokens: TokenSet, now: number): boolean {
  if (tokens.refreshToken !== undefined) return false;
  const expiries = Object.values(tokens.byAudience).map((token) => token.expiresAt);
  return expiries.length > 0 && Math.min(...expiries) <= now;
}

// Failures that say nothing about the grant: the issuer or the network was out
// of reach, or refused the BFF's own secret. A callback that meets one is the
// issuer's or the operator's fault, not the caller's.
const TRANSIENT = new Set([
  'invalid_client',
  'request_failed',
  'discovery_failed',
  'server_error',
  'temporarily_unavailable',
  'unrecognized_error',
]);

// True only when the issuer says the refresh token is no longer good, so the
// session cannot be renewed (RFC 10017 section 6.1.2.2). Every other failure,
// including a refused client secret, is the BFF's or the network's trouble and
// must not end a person's session. The core surfaces `invalid_grant` for a
// revoked, expired or replayed refresh token; the server answers nothing else
// for one.
export function refreshWasRefused(error: unknown): boolean {
  return error instanceof OduduError && error.code === 'invalid_grant';
}

export function remainingTtlMs(createdAt: number, ttlMs: number, now: number): number {
  return Math.max(createdAt + ttlMs - now, 1);
}

// 400 for a callback that is wrong, 502 for one the issuer could not answer.
export function callbackFailureStatus(error: unknown): 400 | 502 {
  return error instanceof OduduError && TRANSIENT.has(error.code) ? 502 : 400;
}
