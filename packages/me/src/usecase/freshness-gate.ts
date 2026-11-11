import { isUuid } from '@odudu/kernel';
import type { MeSessionAuth } from '#/repository/gate';
import { invalidToken } from '#/service/challenge';
import { freshnessChallenge, isFresh } from '#/service/freshness';
import type { MeCaller } from '#/usecase/admit-me';

export interface MeGateDeps {
  readonly sessionAuth: MeSessionAuth;
  readonly now: () => Date;
}

export type FreshnessOutcome =
  | { readonly kind: 'fresh' }
  // The sign-in is too old: a new one answers the challenge.
  | { readonly kind: 'stale'; readonly challenge: string }
  // The session behind the token is gone, so signing in again is a new
  // session and a new token, not a refresh of this one: no challenge to answer.
  | { readonly kind: 'unauthenticated'; readonly challenge: string };

// The sign-in a gated change stands on is the session the token was issued
// for, read once. `acrValues` is what a route that needs a second factor asks
// the challenge to name.
export async function requireFreshSignIn(
  deps: MeGateDeps,
  caller: MeCaller,
  acrValues: string | null = null,
): Promise<FreshnessOutcome> {
  const gone: FreshnessOutcome = { kind: 'unauthenticated', challenge: invalidToken() };
  if (caller.sessionId === null || !isUuid(caller.sessionId)) return gone;
  const now = deps.now();
  const signedInAt = await deps.sessionAuth.signedInAt(
    caller.tenantId,
    caller.subjectId,
    caller.sessionId,
    caller.lifespans,
    now,
  );
  if (signedInAt === null) return gone;
  if (isFresh(signedInAt, now, caller.freshnessSeconds)) return { kind: 'fresh' };
  return { kind: 'stale', challenge: freshnessChallenge(caller.freshnessSeconds, acrValues) };
}
