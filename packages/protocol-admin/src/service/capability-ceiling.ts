import { type TenantScopedDatabase } from '@odudu/db';
import {
  ancestorsOf,
  descendantsOf,
  effectiveRoles,
  groupRoles,
  rolesReachableFrom,
} from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, MANAGE_TENANTS, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

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

/** What a write grants and what it takes away, each beyond the caller's own. */
export interface CeilingBreach {
  readonly granted: readonly string[];
  readonly removed: readonly string[];
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
): Promise<CeilingBreach> {
  const reach = async (ids: string[]): Promise<readonly string[]> =>
    overreach(await capabilitiesReachableFrom(tx, ids), held);
  return {
    granted: await reach(next.filter((id) => !current.includes(id))),
    removed: await reach(current.filter((id) => !next.includes(id))),
  };
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

/**
 * The ids of every subject holding the built-in admin client's role `name`
 * effectively: `effectiveRoles`' walk run backwards — each role that nests
 * it, each group mapping one of those and every group beneath it, and whoever
 * holds or belongs to one. A subquery, so a listing can filter on it.
 */
export function holdersOf(name: string): SQL {
  return sql`(
    WITH RECURSIVE granting(role_id) AS (
      SELECT r.id FROM roles r JOIN clients c ON c.id = r.client_id
      WHERE c.client_id = ${ADMIN_CLIENT_ID} AND r.name = ${name}
      UNION
      SELECT rc.parent_role_id FROM role_composites rc
      JOIN granting g ON rc.child_role_id = g.role_id
    ),
    granting_groups(id) AS (
      SELECT gr.group_id FROM group_roles gr JOIN granting g ON gr.role_id = g.role_id
      UNION
      SELECT ch.id FROM groups ch JOIN granting_groups p ON ch.parent_id = p.id
    )
    SELECT sr.subject_id FROM subject_roles sr JOIN granting g ON g.role_id = sr.role_id
    UNION
    SELECT sg.subject_id FROM subject_groups sg JOIN granting_groups gg ON gg.id = sg.group_id
  )`;
}

/**
 * The subjects a caller holding `held` may not touch: every holder of an
 * admin capability outside it, the target ceiling run as a set rather than
 * one subject at a time. Null when `held` covers every capability, so a
 * tenant-wide write excludes nobody.
 */
export function subjectsBeyond(held: ReadonlySet<string>): SQL | null {
  const missing = [...CAPABILITY_NAMES].filter((name) => !held.has(name));
  if (missing.length === 0) return null;
  return sql`(${sql.join(missing.map(holdersOf), sql` UNION `)})`;
}

const existsRowsSchema = z.array(z.object({ held: z.boolean() }));

/** Whether any subject that is not disabled holds `name` effectively. */
export async function hasEnabledHolder(tx: TenantScopedDatabase, name: string): Promise<boolean> {
  const rows = existsRowsSchema.parse(
    await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM subjects s WHERE s.disabled_at IS NULL AND s.id IN ${holdersOf(name)}
      ) AS held
    `),
  );
  return rows[0]?.held ?? false;
}
