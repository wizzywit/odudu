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

export const listAuditQuerySchema = cursorQuerySchema
  .extend({
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
  })
  .refine((query) => query.resource_id === undefined || query.resource_type !== undefined, {
    message: 'resource_id requires resource_type',
    path: ['resource_id'],
  });
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const auditEventSchema = z.object({
  id: idSchema,
  occurred_at: createdAtSchema,
  event_type: z.string(),
  action: z.string(),
  outcome: z.enum(['allowed', 'refused', 'failed']),
  actor_tenant_id: z.string().nullable(),
  actor_subject_id: z.string().nullable(),
  actor_client_id: z.string().nullable(),
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
