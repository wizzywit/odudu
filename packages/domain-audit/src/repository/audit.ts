import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { auditEvents, type AuditEventRecord } from '#/schema/audit-events';
import {
  assertActionKnown,
  assertDetailAllowed,
  isAuditReason,
  type AuditEventInput,
  type AuditEventType,
} from '#/service/vocabulary';

/** A page's last row, so the next page's query resumes strictly after it. */
export interface AuditCursorPosition {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface AuditEventFilter {
  readonly eventType?: AuditEventType | undefined;
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

// A writer that names no actor tenant is recording an actor of the row's
// own tenant. Only a caller from elsewhere — a system administrator, a
// foreign-issuer token — names another.
const ROW_TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

function validatedRow(event: AuditEventInput): typeof auditEvents.$inferInsert {
  const detail: Record<string, unknown> = event.detail ?? {};
  if (event.eventType !== 'admin_mutation') {
    assertActionKnown(event.eventType, event.action);
    if (event.outcome === 'refused' && !isAuditReason(detail.reason)) {
      throw new Error(`audit event '${event.action}' is refused but has no valid reason`);
    }
    assertDetailAllowed(event.action, detail);
  }

  return {
    id: newId(),
    eventType: event.eventType,
    action: event.action,
    outcome: event.outcome,
    actorTenantId: event.actorTenantId ?? ROW_TENANT,
    actorSubjectId: event.actorSubjectId ?? null,
    actorClientId: event.actorClientId ?? null,
    resourceType: event.resourceType ?? null,
    resourceId: event.resourceId ?? null,
    detail,
  };
}

export function auditRepository(tx: TenantScopedDatabase) {
  return {
    // No tenantId field: audit_events.tenant_id defaults to the same
    // app.tenant_id session variable withTenant already bound this
    // transaction to — the tenant the event happened to, not whichever
    // tenant issued the caller's own token.
    async record(event: AuditEventInput): Promise<void> {
      await tx.insert(auditEvents).values(validatedRow(event));
    },

    // Every event is checked before any is written, and all of them go in
    // one statement: a caller whose row count varies with what happened
    // still issues the same number of statements either way.
    async recordAll(events: readonly AuditEventInput[]): Promise<void> {
      const rows = events.map(validatedRow);
      if (rows.length === 0) return;
      await tx.insert(auditEvents).values(rows);
    },

    // Ordered (occurred_at DESC, id DESC) — newest first, ties broken by id
    // so the order is total and a cursor never repeats or skips a row.
    // `after` compares the pair as a row, the same tuple comparison
    // Postgres uses to answer "strictly before the last row of the
    // previous page" without a second OR-of-conditions branch.
    async list(filter: AuditEventFilter): Promise<AuditEventRecord[]> {
      const conditions: SQL[] = [];
      if (filter.eventType !== undefined) {
        conditions.push(eq(auditEvents.eventType, filter.eventType));
      }
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
