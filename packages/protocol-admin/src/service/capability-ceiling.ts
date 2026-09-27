import { type TenantScopedDatabase } from '@odudu/db';
import { ancestorsOf, groupRoles, rolesReachableFrom } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID } from '@odudu/domain-tenant';
import { inArray } from 'drizzle-orm';

/**
 * The admin-client capability names a set of roles actually grants, each
 * expanded through `role_composites` rather than taken at face value — a
 * composite that nests a capability instead of naming it directly must
 * still be caught. Shared by every capability ceiling in this package
 * (`setRoles`, `addRoleComposite`, `setGroupRoles`, `setScopeRoles`,
 * `setSubjectGroups`, `amendGroup`'s reparent guard): one traversal, never
 * a copy of it.
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

/**
 * What membership of `groupIds` hands a subject: every role mapped to one of
 * them or to any ancestor, expanded through `role_composites` — the reach of
 * `effectiveRoles`' own `group_closure` (@odudu/domain-authz), so a group
 * that inherits a capability from its parent cannot pass for one that
 * carries none.
 */
export async function capabilitiesOfGroupsAndAncestors(
  tx: TenantScopedDatabase,
  groupIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const chain = new Set<string>();
  for (const groupId of groupIds) {
    for (const id of await ancestorsOf(tx, groupId)) chain.add(id);
  }
  if (chain.size === 0) return new Set();
  const mapped = await tx
    .select({ roleId: groupRoles.roleId })
    .from(groupRoles)
    .where(inArray(groupRoles.groupId, [...chain]));
  return capabilitiesReachableFrom(
    tx,
    mapped.map((row) => row.roleId),
  );
}

/** The capability ceiling itself (CWE-269): what `requested` names that `held` does not. */
export function overreach(
  requested: ReadonlySet<string>,
  held: ReadonlySet<string>,
): readonly string[] {
  return [...requested].filter((capability) => !held.has(capability));
}
