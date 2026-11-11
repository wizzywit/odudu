import type { MeReads } from '#/repository/reads';
import type { MeSessionAuth } from '#/repository/gate';
import { invalidToken } from '#/service/challenge';
import { freshnessChallenge, isFresh, namesASession } from '#/service/freshness';
import { HELD_LIMIT, holdsSecondFactor, SECOND_FACTOR_ACR } from '#/service/removal-rule';
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
  if (!namesASession(caller.sessionId)) return gone;
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

// Whether the session the token was issued for still stands: every change
// needs one, however old its sign-in.
export async function requireLiveSession(deps: MeGateDeps, caller: MeCaller): Promise<boolean> {
  if (!namesASession(caller.sessionId)) return false;
  const signedInAt = await deps.sessionAuth.signedInAt(
    caller.tenantId,
    caller.subjectId,
    caller.sessionId,
    caller.lifespans,
    deps.now(),
  );
  return signedInAt !== null;
}

// The authentication class a removal asks the sign-in to have reached: a
// second factor for a person who holds one, none otherwise.
export async function acrForRemoval(
  deps: { readonly reads: MeReads },
  caller: MeCaller,
): Promise<string | null> {
  const held = await deps.reads.credentials(caller.tenantId, caller.subjectId, {
    after: undefined,
    limit: HELD_LIMIT,
  });
  return holdsSecondFactor(held.rows) ? SECOND_FACTOR_ACR : null;
}
