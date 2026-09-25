import { type TenantScopedDatabase } from '@odudu/db';
import { type AuditEvent } from '@odudu/contracts/admin';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { auditRepository } from '#/repository/audit';
import { type AuditEventRecord } from '#/schema/audit-events';

const COLLECTION = 'audit';

export interface ListAuditInput {
  readonly tenantId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly actorSubjectId?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly action?: string | undefined;
  readonly outcome?: 'allowed' | 'refused' | 'failed' | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export type ListAuditOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly AuditEvent[]; next: string | null };

function toWireShape(row: AuditEventRecord): AuditEvent {
  return {
    id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    event_type: row.eventType,
    action: row.action,
    outcome: row.outcome as AuditEvent['outcome'],
    actor_tenant_id: row.actorTenantId,
    actor_subject_id: row.actorSubjectId,
    actor_client_id: row.actorClientId,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    request_id: row.requestId,
    ip: row.ip,
    detail: row.detail as Record<string, unknown>,
  };
}

// `after` packs the composite key the repository's own tuple comparison
// resumes from — occurred_at alone is not unique, so a cursor built from it
// on its own could skip or repeat a row sharing the same instant.
function cursorAfter(cursor: string): { occurredAt: Date; id: string } | null {
  const separator = cursor.lastIndexOf('|');
  if (separator === -1) return null;
  const iso = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  const occurredAt = new Date(iso);
  if (Number.isNaN(occurredAt.getTime()) || id.length === 0) return null;
  return { occurredAt, id };
}

export async function listAudit(
  tx: TenantScopedDatabase,
  input: ListAuditInput,
): Promise<ListAuditOutcome> {
  let after: { occurredAt: Date; id: string } | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    const parsed = cursorAfter(decoded.after);
    if (parsed === null) return { kind: 'invalid_cursor' };
    after = parsed;
  }

  const rows: AuditEventRecord[] = await auditRepository(tx).list({
    ...(input.actorSubjectId !== undefined ? { actorSubjectId: input.actorSubjectId } : {}),
    ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
    ...(input.action !== undefined ? { action: input.action } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    ...(input.from !== undefined ? { from: input.from } : {}),
    ...(input.to !== undefined ? { to: input.to } : {}),
    ...(after !== undefined ? { after } : {}),
    limit: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: `${last.occurredAt.toISOString()}|${last.id}`,
          collection: COLLECTION,
          tenantId: input.tenantId,
        })
      : null;

  return { kind: 'ok', items: page.map(toWireShape), next };
}
