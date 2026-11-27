const DAY_MS = 86_400_000;

/**
 * The instant before which trace rows are deleted: a row exactly the tenant's
 * window old is kept, and one a moment older goes.
 */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
