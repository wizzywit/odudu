import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { auditEvents } from '#/schema/audit-events';

export interface AuditEventInput {
  readonly eventType: string;
  readonly action: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly actorTenantId?: string | null;
  readonly actorSubjectId?: string | null;
  readonly actorClientId?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly detail?: Record<string, unknown> | undefined;
}

export function auditRepository(tx: TenantScopedDatabase) {
  return {
    // No tenantId field: audit_events.tenant_id defaults to the same
    // app.tenant_id session variable withTenant already bound this
    // transaction to, which is the mutation's target rather than
    // whichever tenant issued the caller's own token.
    async record(event: AuditEventInput): Promise<void> {
      await tx.insert(auditEvents).values({
        id: newId(),
        eventType: event.eventType,
        action: event.action,
        outcome: event.outcome,
        actorTenantId: event.actorTenantId ?? null,
        actorSubjectId: event.actorSubjectId ?? null,
        actorClientId: event.actorClientId ?? null,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        requestId: event.requestId ?? null,
        ip: event.ip ?? null,
        detail: event.detail ?? {},
      });
    },
  };
}
