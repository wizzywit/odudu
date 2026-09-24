// Fixed rather than configurable: named in the bootstrap command, the
// capability matrix and the guard that refuses to disable it, so a
// renameable id could hide it from all three.
export const ADMIN_CLIENT_ID = 'odudu-admin';

// The resource identifier an admin token must name in `aud`. A URN and not
// an issuer-derived URL because issuers are resolved per request, so there
// is no issuer to register in the client's audiences when it is created.
export const ADMIN_API_AUDIENCE = 'urn:odudu:params:admin-api';

// Design rationale: docs/superpowers/specs/2026-09-10-odudu-design.md §5.
export const SYSTEM_TENANT_NAME = 'system';

// The bootstrap command creates this row, not a migration: tenants is
// RLS-forced, and a migration has no app.tenant_id to bind the insert to.
export const SYSTEM_TENANT_ID = '0199aa00-0000-7000-8000-000000000001';

export const TENANT_CAPABILITIES = [
  'view-users',
  'manage-users',
  'manage-clients',
  'manage-tenant',
  'manage-keys',
  'manage-sessions',
  'view-audit',
] as const;

export type TenantCapability = (typeof TENANT_CAPABILITIES)[number];

export const TENANT_ADMIN = 'tenant-admin';

export const MANAGE_TENANTS = 'manage-tenants';

// The one predicate both doors that can create a tenant — the admin API's
// `createTenant` and `seed tenant` — refuse a name through, so a caller
// cannot get two different answers depending on which one it asked.
export function isSystemTenantName(name: string): boolean {
  return name === SYSTEM_TENANT_NAME;
}

const VIEW_COUNTERPARTS: Partial<Record<TenantCapability, TenantCapability>> = {
  'manage-users': 'view-users',
};

// A manage- capability implies its view- counterpart, so no subject can be
// granted write without also being able to read.
export function viewCounterpart(capability: TenantCapability): TenantCapability | null {
  return VIEW_COUNTERPARTS[capability] ?? null;
}
