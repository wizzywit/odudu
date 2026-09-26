/**
 * Decides whether a client authentication refusal naming a registered
 * client becomes an audit row or a log line (ADR 0037). `last_row` is the
 * answer that spends the window: its row says so with `rate_limited`. The
 * concrete instance wraps `apps/server/src/throttle.ts`'s `slidingWindow`.
 */
export interface AuditRefusalBudget {
  take: (key: string) => 'row' | 'last_row' | 'log';
}

export function auditRefusalBudgetKey(tenantId: string, clientDbId: string): string {
  return `${tenantId}:${clientDbId}`;
}

// For a caller with no opinion on the budget, stated explicitly rather than
// defaulted, as `UNLIMITED_CLIENT_SECRET_LIMITER` is.
export const UNLIMITED_AUDIT_REFUSAL_BUDGET: AuditRefusalBudget = {
  take: () => 'row',
};
