import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// Mirrors @odudu/domain-audit's AUDIT_EVENT_TYPES: this package stays a
// wire-only contract with no dependency on a server-side domain package, the
// same reason `outcome` below is its own literal rather than AuditOutcome.
const AUDIT_EVENT_TYPES = [
  'admin_mutation',
  'admin_access',
  'authentication',
  'session',
  'token',
  'credential',
] as const;

// A bound on the three free-text filters, not a column width — none of
// resource_type, resource_id or action is ever this long in a row this
// server writes, so a value past it can only be a caller groping for one
// that matches nothing, refused before it reaches Postgres rather than
// after an index scan finds no rows.
const AUDIT_TEXT_FILTER_MAX = 256;

const auditFilters = {
  event_type: z.enum(AUDIT_EVENT_TYPES).optional(),
  // A `uuid` column: anything else reaches Postgres and fails on syntax
  // rather than filtering to nothing.
  actor_subject_id: z.uuid().optional(),
  resource_type: z.string().min(1).max(AUDIT_TEXT_FILTER_MAX).optional(),
  // Not a `uuid` column like `actor_subject_id`: resource_id also holds a
  // reserved client_id string (the `client.create` refusal) and a sha256
  // session digest (`authentication_session` rows) alongside a resource's
  // own id, so anything narrower than text would refuse a real filter.
  resource_id: z.string().min(1).max(AUDIT_TEXT_FILTER_MAX).optional(),
  action: z.string().min(1).max(AUDIT_TEXT_FILTER_MAX).optional(),
  outcome: z.enum(['allowed', 'refused', 'failed']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

function resourceIdNeedsType(query: {
  resource_id?: string | undefined;
  resource_type?: string | undefined;
}): boolean {
  return query.resource_id === undefined || query.resource_type !== undefined;
}
const RESOURCE_ID_NEEDS_TYPE = {
  message: 'resource_id requires resource_type',
  path: ['resource_id'],
};

export const listAuditQuerySchema = cursorQuerySchema
  .extend(auditFilters)
  .refine(resourceIdNeedsType, RESOURCE_ID_NEEDS_TYPE);
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const countAuditQuerySchema = z
  .object(auditFilters)
  .strict()
  .refine(resourceIdNeedsType, RESOURCE_ID_NEEDS_TYPE);
export type CountAuditQuery = z.infer<typeof countAuditQuerySchema>;

// The export reads the same rows under the same filters, unpaged.
export const exportAuditQuerySchema = countAuditQuerySchema;
export type ExportAuditQuery = CountAuditQuery;

// One `auditEventSchema` per line, newest first, and at most this many:
// past it the export is refused whole rather than cut short.
export const AUDIT_EXPORT_MEDIA_TYPE = 'application/x-ndjson';
export const AUDIT_EXPORT_CAP = 10_000;

export const auditEventSchema = z.object({
  id: idSchema,
  occurred_at: createdAtSchema,
  event_type: z.string(),
  action: z.string(),
  outcome: z.enum(['allowed', 'refused', 'failed']),
  actor_tenant_id: z.string().nullable(),
  actor_subject_id: z.string().nullable(),
  actor_client_id: z.string().nullable(),
  // Resolved when the row is read, never stored with it: the username of a
  // user, or the `client_id` whose service account it is, for an actor of
  // this tenant still there to name, to a caller who also holds `view-users`.
  // Null otherwise, and for an actor from elsewhere, whom `actor_origin`
  // names instead: `system` for a system administrator, `other-tenant` for
  // a foreign token refused.
  actor_name: z.string().nullable(),
  actor_origin: z.enum(['tenant', 'system', 'other-tenant']).nullable(),
  resource_type: z.string().nullable(),
  resource_id: z.string().nullable(),
  request_id: z.string().nullable(),
  ip: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const listAuditResponseSchema = z.object({
  items: z.array(auditEventSchema),
  next: z.string().optional(),
});
export type ListAuditResponse = z.infer<typeof listAuditResponseSchema>;
