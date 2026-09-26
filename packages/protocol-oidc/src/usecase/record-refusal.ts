import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type AuditReason, type RequestContext } from '@odudu/domain-audit';
import { type Logger } from '@odudu/kernel';
import { auditRefusalBudgetKey, type AuditRefusalBudget } from '#/service/audit-refusal-budget';
import { type TokenRefusalAudit } from '#/service/errors';

export interface RecordRefusalDeps {
  database: DatabaseHandle;
  logger: Pick<Logger, 'warn' | 'error'>;
  budget: AuditRefusalBudget;
}

function write(tx: TenantScopedDatabase, audit: TokenRefusalAudit, reason: AuditReason) {
  const common = {
    outcome: 'refused',
    actorClientId: audit.clientDbId,
    actorSubjectId: audit.subjectId ?? null,
    resourceType: audit.grantId === undefined ? null : 'grant',
    resourceId: audit.grantId ?? null,
  } as const;
  const repository = auditRepository(tx);
  switch (audit.action) {
    case 'client.authenticate':
      return repository.record({
        ...common,
        eventType: 'authentication',
        action: 'client.authenticate',
        detail: audit.method === undefined ? { reason } : { method: audit.method, reason },
      });
    case 'token.issue':
      return repository.record({
        ...common,
        eventType: 'token',
        action: 'token.issue',
        detail: { reason },
      });
    case 'token.refresh':
      return repository.record({
        ...common,
        eventType: 'token',
        action: 'token.refresh',
        detail: { reason },
      });
    case 'token.exchange':
      return repository.record({
        ...common,
        eventType: 'token',
        action: 'token.exchange',
        detail: { reason },
      });
    case 'token.revoke':
      return repository.record({
        ...common,
        eventType: 'token',
        action: 'token.revoke',
        detail: { reason },
      });
  }
}

/**
 * Records a `/token`, `/revoke` or `/introspect` refusal in a transaction of
 * its own, since the request's own rolled back when it threw. Never throws:
 * the caller gets the refusal it was always going to get, whatever happens
 * here. Every refusal spends its client's budget, authenticated or not: a
 * public client authenticates with its name alone (ADR 0037).
 */
export async function recordRefusal(
  deps: RecordRefusalDeps,
  tenantId: string,
  request: RequestContext,
  audit: TokenRefusalAudit | undefined,
): Promise<void> {
  if (audit === undefined) return;

  const answer = deps.budget.take(auditRefusalBudgetKey(tenantId, audit.clientDbId));
  if (answer === 'log') {
    deps.logger.warn(
      { tenantId, clientDbId: audit.clientDbId, action: audit.action, reason: audit.reason },
      'refusal not recorded: audit budget for this client is spent',
    );
    return;
  }
  const reason = answer === 'last_row' ? 'rate_limited' : audit.reason;

  try {
    await withTenant(deps.database.db, tenantId, (tx) => write(tx, audit, reason), request);
  } catch (error) {
    deps.logger.error(
      { err: error, tenantId, action: audit.action },
      'could not record a refused token request',
    );
  }
}
