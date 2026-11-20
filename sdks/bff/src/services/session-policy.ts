import { OduduError } from '@odudu-io/oidc';
import type { TokenSet } from '@odudu-io/oidc';

export const REFRESH_SKEW_MS = 30_000;
export const LOGIN_TTL_MS = 10 * 60 * 1000;

// An access token about to expire is renewed, when there is a refresh token to
// renew it with. The soonest expiry counts: every audience is renewed together.
export function needsRefresh(tokens: TokenSet, now: number): boolean {
  if (tokens.refreshToken === undefined) return false;
  const expiries = Object.values(tokens.byAudience).map((token) => token.expiresAt);
  return expiries.length > 0 && Math.min(...expiries) - now <= REFRESH_SKEW_MS;
}

// Failures that say nothing about the grant: the issuer or the network was out
// of reach, and the session should survive them.
const TRANSIENT = new Set([
  'request_failed',
  'discovery_failed',
  'server_error',
  'temporarily_unavailable',
  'unrecognized_error',
]);

// True when the issuer turned the refresh token down, so the session can no
// longer be renewed (RFC 10017 section 6.1.2.2).
export function refreshWasRefused(error: unknown): boolean {
  return error instanceof OduduError && !TRANSIENT.has(error.code);
}

export function remainingTtlMs(createdAt: number, ttlMs: number, now: number): number {
  return Math.max(createdAt + ttlMs - now, 1);
}

// 400 for a callback that is wrong, 502 for one the issuer could not answer.
export function callbackFailureStatus(error: unknown): 400 | 502 {
  return error instanceof OduduError && TRANSIENT.has(error.code) ? 502 : 400;
}
