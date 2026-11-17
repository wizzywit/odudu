import { acrFor } from '@odudu/protocol-oidc';
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
  const stale: FreshnessOutcome = {
    kind: 'stale',
    challenge: freshnessChallenge(caller.freshnessSeconds, acrValues),
  };
  if (!isFresh(signedInAt, now, caller.freshnessSeconds)) return stale;
  if (acrValues === null) return { kind: 'fresh' };
  // A recent sign-in is not enough where a class is asked for: the one the
  // session ran has to have reached it, as an application that ignores
  // `acr_values` would otherwise pass with a weaker client's sign-in.
  const ran = await deps.sessionAuth.authenticators(
    caller.tenantId,
    caller.subjectId,
    caller.sessionId,
    caller.lifespans,
    now,
  );
  return ran !== null && reaches(acrFor(ran), acrValues) ? { kind: 'fresh' } : stale;
}

// `acr` values are the numbers of factors a sign-in ran, so one reaches another
// when it is not lower; a session that recorded no authenticators reaches none.
function reaches(achieved: string | null, asked: string): boolean {
  return achieved !== null && Number(achieved) >= Number(asked);
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
