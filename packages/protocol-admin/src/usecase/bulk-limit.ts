/**
 * The most rows one request writes in bulk (a lockouts clear, a client's grants
 * revoked) and the most a count reports: one transaction short enough not to
 * hold a tenant's rows locked, and a number past it says no more than it does.
 */
export const BULK_WRITE_LIMIT = 10_000;
