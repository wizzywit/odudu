import { type EffectiveRole } from '@odudu/domain-authz';
import { MANAGE_TENANTS, type TenantCapability } from '@odudu/domain-tenant';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';

export interface AuthorizeAdminDeps {
  effectiveRoles(tenantId: string, subjectId: string): Promise<readonly EffectiveRole[]>;
}

export interface AuthorizeAdminTarget {
  /** The tenant named in the request path, not necessarily the caller's own. */
  readonly tenantId: string;
}

export type AuthorizeAdminOutcome = 'allowed' | 'forbidden';

// Roles are resolved against the principal's own issuer tenant, never the
// path tenant: that is where the principal's subject and its role rows
// actually live under row-level security, for a tenant-local admin and a
// system admin alike (@odudu/domain-tenant provisions the same capability
// roles, plus `manage-tenants`, under every tenant including `system`). A
// system admin reaching another tenant's path additionally needs
// `manage-tenants`, checked against that same resolution.
export async function authorizeAdmin(
  deps: AuthorizeAdminDeps,
  principal: AdminPrincipal,
  target: AuthorizeAdminTarget,
  required: TenantCapability | null,
): Promise<AuthorizeAdminOutcome> {
  if (required === null) return 'allowed';

  const roles = await deps.effectiveRoles(principal.issuerTenantId, principal.subjectId);
  const names = new Set(roles.map((role) => role.name));
  if (!names.has(required)) return 'forbidden';

  const crossTenant = principal.issuerTenantId !== target.tenantId;
  if (crossTenant && !names.has(MANAGE_TENANTS)) return 'forbidden';

  return 'allowed';
}
