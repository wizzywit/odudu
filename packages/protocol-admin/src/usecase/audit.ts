import { type TenantScopedDatabase } from '@odudu/db';
import { type AuditEvent } from '@odudu/contracts/admin';
import {
  auditRepository,
  type AuditEventCriteria,
  type AuditEventRecord,
  type AuditEventType,
} from '@odudu/domain-audit';
import { subjects, users } from '@odudu/domain-identity';
import { clients, isSystemTenantId } from '@odudu/domain-tenant';
import { eq, inArray } from 'drizzle-orm';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

const COLLECTION = 'audit';

export interface ListAuditInput {
  readonly tenantId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly eventType?: AuditEventType | undefined;
  readonly actorSubjectId?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly action?: string | undefined;
  readonly outcome?: 'allowed' | 'refused' | 'failed' | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export type ListAuditOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly AuditEvent[]; next: string | null };

type ActorNames = ReadonlyMap<string, string>;

/**
 * The name of each actor of `tenantId`'s own that is still there to name:
 * a user's username, or the `client_id` of the client a service account
 * belongs to. Read under the row's own tenant, so an actor of any other
 * tenant never resolves, whatever its id.
 */
export async function resolveActors(
  tx: TenantScopedDatabase,
  tenantId: string,
  rows: readonly { actorSubjectId: string | null; actorTenantId: string | null }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.actorSubjectId !== null && row.actorTenantId === tenantId ? [row.actorSubjectId] : [],
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const found = await tx
    .select({ id: subjects.id, username: users.username, clientKey: clients.clientId })
    .from(subjects)
    .leftJoin(users, eq(users.subjectId, subjects.id))
    .leftJoin(clients, eq(clients.serviceSubjectId, subjects.id))
    .where(inArray(subjects.id, ids));
  const names = new Map<string, string>();
  for (const row of found) {
    const name = row.username ?? row.clientKey;
    if (name !== null) names.set(row.id, name);
  }
  return names;
}

function originOf(tenantId: string, row: AuditEventRecord): AuditEvent['actor_origin'] {
  if (row.actorSubjectId === null || row.actorTenantId === null) return null;
  if (row.actorTenantId === tenantId) return 'tenant';
  return isSystemTenantId(row.actorTenantId) ? 'system' : 'other-tenant';
}

function toWireShape(tenantId: string, names: ActorNames, row: AuditEventRecord): AuditEvent {
  const origin = originOf(tenantId, row);
  return {
    id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    event_type: row.eventType,
    action: row.action,
    outcome: row.outcome as AuditEvent['outcome'],
    actor_tenant_id: row.actorTenantId,
    actor_subject_id: row.actorSubjectId,
    actor_client_id: row.actorClientId,
    actor_name:
      origin === 'tenant' && row.actorSubjectId !== null
        ? (names.get(row.actorSubjectId) ?? null)
        : null,
    actor_origin: origin,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    request_id: row.requestId,
    ip: row.ip,
    detail: row.detail as Record<string, unknown>,
  };
}

/** Rows as the wire carries them, their actors named by `resolveActors`. */
export async function auditWireShapes(
  tx: TenantScopedDatabase,
  tenantId: string,
  rows: readonly AuditEventRecord[],
): Promise<AuditEvent[]> {
  const names = await resolveActors(tx, tenantId, rows);
  return rows.map((row) => toWireShape(tenantId, names, row));
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
  const filters = filterDigest({
    event_type: input.eventType,
    actor_subject_id: input.actorSubjectId,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    action: input.action,
    outcome: input.outcome,
    from: input.from?.toISOString(),
    to: input.to?.toISOString(),
  });
  let after: { occurredAt: Date; id: string } | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    const parsed = cursorAfter(decoded.after);
    if (parsed === null) return { kind: 'invalid_cursor' };
    after = parsed;
  }

  const rows: AuditEventRecord[] = await auditRepository(tx).list({
    ...(input.eventType !== undefined ? { eventType: input.eventType } : {}),
    ...(input.actorSubjectId !== undefined ? { actorSubjectId: input.actorSubjectId } : {}),
    ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
    ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
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
          filters,
        })
      : null;

  return { kind: 'ok', items: await auditWireShapes(tx, input.tenantId, page), next };
}

export async function countAudit(
  tx: TenantScopedDatabase,
  criteria: AuditEventCriteria,
  cap: number,
): Promise<{ count: number; capped: boolean }> {
  return auditRepository(tx).count(criteria, cap);
}

export interface AuditExportAuditEvent {
  readonly action: 'audit.export';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: Record<string, unknown>;
}

export interface ExportAuditInput {
  readonly tenantId: string;
  readonly filters: AuditEventCriteria;
  readonly cap: number;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type ExportAuditOutcome =
  { kind: 'too_many'; cap: number } | { kind: 'ok'; items: readonly AuditEvent[] };

// Every matching row or none: an export cut off at a limit would read as
// the whole trail. It is itself audited, as a tenant export is, since it
// hands the trail over in bulk.
export async function exportAudit(
  tx: TenantScopedDatabase,
  deps: {
    readonly audit: (tx: TenantScopedDatabase, event: AuditExportAuditEvent) => Promise<void>;
  },
  input: ExportAuditInput,
): Promise<ExportAuditOutcome> {
  const rows = await auditRepository(tx).list({ ...input.filters, limit: input.cap + 1 });
  if (rows.length > input.cap) return { kind: 'too_many', cap: input.cap };
  const items = await auditWireShapes(tx, input.tenantId, rows);
  await deps.audit(tx, {
    action: 'audit.export',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { exported: items.length },
  });
  return { kind: 'ok', items };
}
