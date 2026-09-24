import { type TenantScopedDatabase } from '@odudu/db';
import { rolesReachableFrom } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID } from '@odudu/domain-tenant';

/**
 * The admin-client capability names a set of roles actually grants, each
 * expanded through `role_composites` rather than taken at face value — a
 * composite that nests a capability instead of naming it directly must
 * still be caught. Shared by every capability ceiling in this package
 * (`setRoles`, `addRoleComposite`, `setGroupRoles`, `setScopeRoles`,
 * `amendGroup`'s reparent guard): one traversal, never a copy of it.
 */
export async function capabilitiesReachableFrom(
  tx: TenantScopedDatabase,
  roleIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (roleIds.length === 0) return new Set();
  const reachable = await rolesReachableFrom(tx, roleIds);
  return new Set(
    reachable.filter((role) => role.clientKey === ADMIN_CLIENT_ID).map((role) => role.name),
  );
}

/** The capability ceiling itself (CWE-269): what `requested` names that `held` does not. */
export function overreach(
  requested: ReadonlySet<string>,
  held: ReadonlySet<string>,
): readonly string[] {
  return [...requested].filter((capability) => !held.has(capability));
}
