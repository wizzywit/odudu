import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { auditEvents, type AuditEventRecord } from '#/schema/audit-events';

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

/** A page's last row, so the next page's query resumes strictly after it. */
export interface AuditCursorPosition {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface AuditEventFilter {
  readonly actorSubjectId?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly action?: string | undefined;
  readonly outcome?: 'allowed' | 'refused' | 'failed' | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly after?: AuditCursorPosition | undefined;
  /** Fetched as `limit + 1` by the caller, to learn whether another page follows. */
  readonly limit: number;
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

    // Ordered (occurred_at DESC, id DESC) — newest first, ties broken by id
    // so the order is total and a cursor never repeats or skips a row.
    // `after` compares the pair as a row, the same tuple comparison
    // Postgres uses to answer "strictly before the last row of the
    // previous page" without a second OR-of-conditions branch.
    async list(filter: AuditEventFilter): Promise<AuditEventRecord[]> {
      const conditions: SQL[] = [];
      if (filter.actorSubjectId !== undefined) {
        conditions.push(eq(auditEvents.actorSubjectId, filter.actorSubjectId));
      }
      if (filter.resourceType !== undefined) {
        conditions.push(eq(auditEvents.resourceType, filter.resourceType));
      }
      if (filter.action !== undefined) {
        conditions.push(eq(auditEvents.action, filter.action));
      }
      if (filter.outcome !== undefined) {
        conditions.push(eq(auditEvents.outcome, filter.outcome));
      }
      if (filter.from !== undefined) {
        conditions.push(
          sql`${auditEvents.occurredAt} >= ${filter.from.toISOString()}::timestamptz`,
        );
      }
      if (filter.to !== undefined) {
        conditions.push(sql`${auditEvents.occurredAt} <= ${filter.to.toISOString()}::timestamptz`);
      }
      if (filter.after !== undefined) {
        conditions.push(
          sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (${filter.after.occurredAt.toISOString()}::timestamptz, ${filter.after.id})`,
        );
      }

      return tx
        .select()
        .from(auditEvents)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
        .limit(filter.limit);
    },
  };
}
