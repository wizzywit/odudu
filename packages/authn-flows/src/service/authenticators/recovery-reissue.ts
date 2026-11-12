export const REISSUE_INTERVAL_MS = 60 * 60 * 1000;

export type ReissueVerdict = { ok: true } | { ok: false; retryAt: Date };

// A set may be replaced once an hour: issuing costs ten Argon2id hashes. The
// first set, and one with nothing left to spend, are never held back, because
// refusing either would leave a person with no way back.
export function reissueAllowed(
  lastIssuedAt: Date | null,
  spentAll: boolean,
  now: Date,
): ReissueVerdict {
  if (lastIssuedAt === null || spentAll) return { ok: true };
  const retryAt = new Date(lastIssuedAt.getTime() + REISSUE_INTERVAL_MS);
  return retryAt.getTime() <= now.getTime() ? { ok: true } : { ok: false, retryAt };
}

// The latest last-issued time that still allows a replacement at `now`.
export function reissueCutoff(now: Date): Date {
  return new Date(now.getTime() - REISSUE_INTERVAL_MS);
}

export function retryInMinutes(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000));
}
