// The client every tenant's administration roles hang from. Fixed rather
// than configurable: it is named in the bootstrap command, in the capability
// matrix and in the guard that refuses to disable it, and a tenant that
// could rename it could hide it from all three.
export const ADMIN_CLIENT_ID = 'odudu-admin';

// Cross-tenant administration is a permission, not a property of living in a
// particular tenant — so this tenant is structurally identical to every other
// and holds only the subjects granted that permission.
export const SYSTEM_TENANT_NAME = 'system';

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

/** Holds every capability in `TENANT_CAPABILITIES`, as a composite role. */
export const TENANT_ADMIN = 'tenant-admin';

/** Reaches every tenant. Provisioned only in the system tenant. */
export const MANAGE_TENANTS = 'manage-tenants';

const VIEW_COUNTERPARTS: Partial<Record<TenantCapability, TenantCapability>> = {
  'manage-users': 'view-users',
};

// Granting a manage- capability must never also require granting its view-
// counterpart beside it: the composite carries the read, so an operator
// cannot produce a subject that may write a thing it cannot read.
export function viewCounterpart(capability: TenantCapability): TenantCapability | null {
  return VIEW_COUNTERPARTS[capability] ?? null;
}
