import { type TenantScopedDatabase } from '@odudu/db';
import {
  ancestorsOf,
  descendantsOf,
  effectiveRoles,
  groupRoles,
  rolesReachableFrom,
} from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, MANAGE_TENANTS, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { inArray } from 'drizzle-orm';

/**
 * The admin-client capability names a set of roles actually grants, each
 * expanded through `role_composites` rather than taken at face value — a
 * composite that nests a capability instead of naming it directly must
 * still be caught. Shared by every capability ceiling in this package, on
 * what a write grants and on what a removal takes away: one traversal,
 * never a copy of it.
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

/**
 * What deleting `groupId` takes from the subjects in it and beneath it: its
 * subtree goes with it (`groups_parent_fk` cascades), and with it every role
 * mapped anywhere in that subtree or inherited from above it.
 */
export async function capabilitiesOfSubtree(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<ReadonlySet<string>> {
  return capabilitiesOfGroupsAndAncestors(tx, [groupId, ...(await descendantsOf(tx, groupId))]);
}

/**
 * A wholesale replacement of a role set, judged by its delta: what `next`
 * adds to `current` and what it takes away both have to be within `held`,
 * and a role kept in both is never counted.
 */
export async function replacementOverreach(
  tx: TenantScopedDatabase,
  current: readonly string[],
  next: readonly string[],
  held: ReadonlySet<string>,
): Promise<readonly string[]> {
  const changed = [
    ...next.filter((id) => !current.includes(id)),
    ...current.filter((id) => !next.includes(id)),
  ];
  return overreach(await capabilitiesReachableFrom(tx, changed), held);
}

/** The capability ceiling itself (CWE-269): what `requested` names that `held` does not. */
export function overreach(
  requested: ReadonlySet<string>,
  held: ReadonlySet<string>,
): readonly string[] {
  return [...requested].filter((capability) => !held.has(capability));
}

const CAPABILITY_NAMES: ReadonlySet<string> = new Set([...TENANT_CAPABILITIES, MANAGE_TENANTS]);

/**
 * The target ceiling: what the admin capabilities `subjectId` holds name that
 * `held` does not. Every mutation that can change who authenticates as a
 * subject, or what it holds, is refused unless this is empty: every route
 * under `/subjects/:id`, its roles and groups included so a target cannot be
 * demoted out from under the check first, and every route that mutates a
 * client, on that client's service account. Resolved through
 * `effectiveRoles`, as the caller's are.
 */
export async function targetOverreach(
  tx: TenantScopedDatabase,
  subjectId: string,
  held: ReadonlySet<string>,
): Promise<readonly string[]> {
  const roles = await effectiveRoles(tx, subjectId);
  const targetHolds = new Set(
    roles
      .filter((role) => role.clientKey === ADMIN_CLIENT_ID && CAPABILITY_NAMES.has(role.name))
      .map((role) => role.name),
  );
  return overreach(targetHolds, held);
}
