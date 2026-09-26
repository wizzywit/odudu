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

export const listAuditQuerySchema = cursorQuerySchema.extend({
  event_type: z.enum(AUDIT_EVENT_TYPES).optional(),
  // A `uuid` column: anything else reaches Postgres and fails on syntax
  // rather than filtering to nothing.
  actor_subject_id: z.uuid().optional(),
  resource_type: z.string().optional(),
  action: z.string().optional(),
  outcome: z.enum(['allowed', 'refused', 'failed']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
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
