export const REISSUE_INTERVAL_MS = 60 * 60 * 1000;

// A set the sign-in is waiting for is issued again by a reload of its page,
// each reload costing the hashes of a whole set, so reloads are held to one
// every half minute: long enough to bound the work a person with a valid
// password and a session can ask for (two sets a minute), short enough that a
// person who lost the page waits only that long, and the acknowledgement that
// finishes the sign-in carries no code and is never held back.
export const OWED_INTERVAL_MS = 30 * 1000;

export type ReissueVerdict = { ok: true } | { ok: false; retryAt: Date };

export interface ReissueStanding {
  spentAll: boolean;
  // The sign-in cannot finish until a set is issued and acknowledged.
  owed: boolean;
}

// Whether the bound does not apply at all, whatever the last issue time: a set
// with nothing left to spend is replaced at once, because refusing it would
// leave a person with no way back. The repository's claim takes this same
// answer, so the two cannot differ.
export function bypassesBound(standing: ReissueStanding): boolean {
  return standing.spentAll;
}

function intervalMs(standing: ReissueStanding): number {
  return standing.owed ? OWED_INTERVAL_MS : REISSUE_INTERVAL_MS;
}

// A set may be replaced once an hour, and one the sign-in is waiting for once
// every half minute: issuing costs one Argon2id hash a code. The first set and
// one with nothing left to spend are never held back.
export function reissueAllowed(
  lastIssuedAt: Date | null,
  standing: ReissueStanding,
  now: Date,
): ReissueVerdict {
  if (lastIssuedAt === null || bypassesBound(standing)) return { ok: true };
  const retryAt = new Date(lastIssuedAt.getTime() + intervalMs(standing));
  return retryAt.getTime() <= now.getTime() ? { ok: true } : { ok: false, retryAt };
}

// The latest last-issued time that still allows a replacement at `now`.
export function reissueCutoff(now: Date, standing: ReissueStanding): Date {
  return new Date(now.getTime() - intervalMs(standing));
}

export function retryInSeconds(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
}

export function retryInMinutes(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000));
}
