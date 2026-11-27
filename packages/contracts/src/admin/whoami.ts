import { z } from 'zod';

// Mirrors @odudu/domain-tenant's TENANT_CAPABILITIES plus MANAGE_TENANTS:
// this package stays a wire-only contract with no dependency on a
// server-side domain package, the same reason audit.ts's
// AUDIT_EVENT_TYPES is its own literal rather than an import. Excludes
// TENANT_ADMIN and any other role defined on the built-in admin client —
// those are composite roles, not members of the capability vocabulary
// whoami reports.
export const ADMIN_CAPABILITIES = [
  'view-users',
  'manage-users',
  'manage-clients',
  'manage-tenant',
  'manage-keys',
  'manage-sessions',
  'view-audit',
  'view-domains',
  'manage-domains',
  'use-assistant',
  'read-assistant-activity',
  'manage-assistant',
  'manage-tenants',
] as const;

export const whoamiResponseSchema = z.object({
  subjectId: z.string(),
  issuerTenantId: z.string(),
  issuerTenantName: z.string(),
  capabilities: z.array(z.enum(ADMIN_CAPABILITIES)),
  crossTenant: z.boolean(),
  // Whether this deployment resolved a standard model, which is whether the
  // assistant's settings routes are served at all: a console that reads it
  // never asks for a route it expects to be answered as never served. Absent
  // from the answer to an AI agent's token, which is told nothing of the assistant.
  assistant_available: z.boolean().optional(),
});
export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;
