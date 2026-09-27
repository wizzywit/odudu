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
  'manage-tenants',
] as const;

export const whoamiResponseSchema = z.object({
  subjectId: z.string(),
  issuerTenantId: z.string(),
  capabilities: z.array(z.enum(ADMIN_CAPABILITIES)),
  crossTenant: z.boolean(),
});
export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;
