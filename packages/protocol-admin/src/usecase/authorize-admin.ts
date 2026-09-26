import { type EffectiveRole } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, MANAGE_TENANTS } from '@odudu/domain-tenant';
import { type AdminCapability } from '#/service/capability';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';

export interface AuthorizeAdminDeps {
  effectiveRoles(tenantId: string, subjectId: string): Promise<readonly EffectiveRole[]>;
}

export interface AuthorizeAdminTarget {
  /** The tenant named in the request path, not necessarily the caller's own. */
  readonly tenantId: string;
}

export type AuthorizeAdminOutcome =
  { readonly kind: 'allowed' } | { readonly kind: 'forbidden'; readonly missing: AdminCapability };

const ALLOWED: AuthorizeAdminOutcome = { kind: 'allowed' };

// Roles are resolved against the principal's own issuer tenant, never the
// path tenant: that is where its subject and role rows actually live under
// row-level security, for a tenant-local admin and a system admin alike.
// The cross-tenant check applies regardless of the route's own capability
// — including a `null` one like `whoami` — so `manage-tenants` is checked
// first and `required === null` only skips the second check.
export async function authorizeAdmin(
  deps: AuthorizeAdminDeps,
  principal: AdminPrincipal,
  target: AuthorizeAdminTarget,
  required: AdminCapability | null,
): Promise<AuthorizeAdminOutcome> {
  const crossTenant = principal.issuerTenantId !== target.tenantId;
  if (!crossTenant && required === null) return ALLOWED;

  const roles = await deps.effectiveRoles(principal.issuerTenantId, principal.subjectId);
  // A capability is a role on the built-in admin client and nowhere else.
  // Matching on the name alone would let an application's own role, or a
  // tenant role, named `manage-users` administer this tenant.
  const names = new Set(
    roles.filter((role) => role.clientKey === ADMIN_CLIENT_ID).map((role) => role.name),
  );

  if (crossTenant && !names.has(MANAGE_TENANTS)) {
    return { kind: 'forbidden', missing: MANAGE_TENANTS };
  }
  if (required !== null && !names.has(required)) return { kind: 'forbidden', missing: required };

  return ALLOWED;
}
