import { type TenantScopedDatabase } from '@odudu/db';
import {
  ancestorsOf,
  descendantsOf,
  groupRepository,
  groupRoles,
  roleRepository,
  rolesReachableFrom,
} from '@odudu/domain-authz';
import { inArray, sql } from 'drizzle-orm';

// A default role or a default group is handed to every subject created
// afterwards — through self-registration too, where the tenant allows it — so
// nothing it reaches may be an admin capability, whoever the caller is. Every
// write that can widen that reach takes this lock before it reads the graph,
// and after every row it will write or its foreign keys will check is locked:
// a writer that took it first could then wait on a row another holds while
// waiting for it. A write that only shrinks the reach goes without.
export async function lockDefaultReach(tx: TenantScopedDatabase): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('role_default_reach'), hashtext(current_setting('app.tenant_id')))`,
  );
}

/** Every role a default role or a default group hands out, composites expanded. */
export async function defaultReachRoleIds(tx: TenantScopedDatabase): Promise<ReadonlySet<string>> {
  const seeds = new Set((await roleRepository(tx).defaultsForTenant()).map((role) => role.id));
  const chain = new Set<string>();
  for (const group of await groupRepository(tx).defaultsForTenant()) {
    for (const id of await ancestorsOf(tx, group.id)) chain.add(id);
  }
  if (chain.size > 0) {
    const mapped = await tx
      .select({ roleId: groupRoles.roleId })
      .from(groupRoles)
      .where(inArray(groupRoles.groupId, [...chain]));
    for (const { roleId } of mapped) seeds.add(roleId);
  }
  const reached = await rolesReachableFrom(tx, [...seeds]);
  return new Set(reached.map((role) => role.roleId));
}

/**
 * Whether a default group is `groupId` or lies beneath it, so that every role
 * mapped to `groupId`, and every role above it, is handed to new subjects.
 */
export async function holdsDefaultGroup(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<boolean> {
  const defaults = await groupRepository(tx).defaultsForTenant();
  if (defaults.length === 0) return false;
  const subtree = new Set([groupId, ...(await descendantsOf(tx, groupId))]);
  return defaults.some((group) => subtree.has(group.id));
}
