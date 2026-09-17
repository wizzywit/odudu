// The realm's brute-force switches, as the lockout arithmetic reads them
// (packages/db/drizzle/0041_login_failures.sql holds the columns and the
// bounds a realm cannot configure its way out of).
export interface LockoutPolicy {
  // How many consecutive failures the account tolerates before the next
  // one locks it.
  maxFailures: number;
  // How long the first lockout lasts; each further failure doubles it.
  lockoutSeconds: number;
  // The ceiling the doubling stops at.
  maxLockoutSeconds: number;
  // How long an account must go unattacked for the run of failures to be
  // forgotten and counting to start again from one.
  failureResetSeconds: number;
}

// What is on record for one subject. A subject with no row is this state
// with a zero count and no last failure — never a locked one, because the
// row is created by a failure and a subject who has never failed is not
// under attack.
export interface LockoutState {
  failureCount: number;
  lastFailureAt: Date | null;
}

export interface NextLockout {
  failureCount: number;
  lockedUntil: Date | null;
}

function runIsBroken(state: LockoutState, policy: LockoutPolicy, now: Date): boolean {
  if (state.lastFailureAt === null) return true;
  return now.getTime() - state.lastFailureAt.getTime() >= policy.failureResetSeconds * 1000;
}

/**
 * What one further failed attempt makes of the state on record: the count
 * it becomes, and the instant the account stops being refused, or null when
 * the account is not locked at all.
 *
 * The doubling counts from the threshold, so the attempt that reaches
 * `maxFailures` locks for `lockoutSeconds` and each one after that for
 * twice as long, up to `maxLockoutSeconds`.
 */
export function nextLockout(state: LockoutState, policy: LockoutPolicy, now: Date): NextLockout {
  const failureCount = runIsBroken(state, policy, now) ? 1 : state.failureCount + 1;
  if (failureCount < policy.maxFailures) {
    return { failureCount, lockedUntil: null };
  }
  const doubled = policy.lockoutSeconds * 2 ** (failureCount - policy.maxFailures);
  const seconds = Math.min(doubled, policy.maxLockoutSeconds);
  return { failureCount, lockedUntil: new Date(now.getTime() + seconds * 1000) };
}

/**
 * Whether an attempt judged at `now` is refused for the lockout already on
 * record. The boundary is exclusive: the instant `locked_until` names is
 * the first instant the account can be signed into again.
 */
export function isLockedOut(state: { lockedUntil: Date | null }, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}
