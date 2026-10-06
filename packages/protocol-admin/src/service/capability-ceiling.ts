import { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  ancestorsOf,
  descendantsOf,
  effectiveRoles,
  groupRoles,
  rolesReachableFrom,
} from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
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
  const chain = await ancestorsOf(tx, groupIds);
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
      SELECT rc.parent_role_id
      FROM granting g
      CROSS JOIN LATERAL (
        SELECT parent_role_id FROM role_composites WHERE child_role_id = g.role_id OFFSET 0
      ) rc
    ),
    granting_groups(id) AS (
      SELECT gr.group_id
      FROM granting g
      CROSS JOIN LATERAL (
        SELECT group_id FROM group_roles WHERE role_id = g.role_id OFFSET 0
      ) gr
      UNION
      SELECT ch.id
      FROM granting_groups p
      CROSS JOIN LATERAL (SELECT id FROM groups WHERE parent_id = p.id OFFSET 0) ch
    )
    SELECT sr.subject_id
    FROM granting g
    CROSS JOIN LATERAL (
      SELECT subject_id FROM subject_roles WHERE role_id = g.role_id OFFSET 0
    ) sr
    UNION
    SELECT sg.subject_id
    FROM granting_groups gg
    CROSS JOIN LATERAL (
      SELECT subject_id FROM subject_groups WHERE group_id = gg.id OFFSET 0
    ) sg
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
  // An array, read once: the planner probes the filtered table by subject
  // rather than hashing the holders against a scan of it.
  return sql`ARRAY(${sql.join(missing.map(holdersOf), sql` UNION `)})`;
}

/** `column` is the id of a subject `subjectsBeyond` named. */
export function isBeyond(column: AnyColumn, beyond: SQL): SQL {
  return sql`${column} = ANY(${beyond})`;
}

/** `column` is not the id of a subject `subjectsBeyond` named. */
export function isNotBeyond(column: AnyColumn, beyond: SQL): SQL {
  return sql`${column} <> ALL(${beyond})`;
}

/** Every holder of any admin capability: the target ceiling's set with nothing held. */
export function holdersOfAny(): SQL {
  return sql`(${sql.join([...CAPABILITY_NAMES].map(holdersOf), sql` UNION `)})`;
}

const HOLDINGS: readonly string[] = [TENANT_ADMIN, ...CAPABILITY_NAMES];

const heldRowsSchema = z.array(
  z.object({ subject_id: z.string(), name: z.string(), direct: z.boolean() }),
);

export interface HeldCapability {
  readonly name: string;
  /** Assigned to the subject itself, rather than only through a group or a composite. */
  readonly direct: boolean;
}

/**
 * What each of `subjectIds` holds of the admin vocabulary, effectively, and
 * whether by a direct assignment: one query for a whole page, so a listing
 * never asks per row. Which group or composite carries it is
 * `GET …/effective-roles`' answer, read for one subject at a time.
 */
export async function adminCapabilitiesOf(
  tx: TenantScopedDatabase,
  subjectIds: readonly string[],
): Promise<ReadonlyMap<string, readonly HeldCapability[]>> {
  const held = new Map<string, HeldCapability[]>();
  if (subjectIds.length === 0) return held;
  const ids = sql.join(
    subjectIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const each = HOLDINGS.map(
    (name) => sql`
      SELECT h.subject_id::text AS subject_id, ${name}::text AS name, EXISTS (
        SELECT 1 FROM subject_roles sr
        JOIN roles r ON r.id = sr.role_id JOIN clients c ON c.id = r.client_id
        WHERE c.client_id = ${ADMIN_CLIENT_ID} AND r.name = ${name} AND sr.subject_id = h.subject_id
      ) AS direct
      FROM ${holdersOf(name)} AS h(subject_id) WHERE h.subject_id IN (${ids})`,
  );
  const rows = heldRowsSchema.parse(await tx.execute(sql.join(each, sql` UNION ALL `)));
  for (const name of HOLDINGS) {
    for (const row of rows.filter((candidate) => candidate.name === name)) {
      held.set(row.subject_id, [...(held.get(row.subject_id) ?? []), { name, direct: row.direct }]);
    }
  }
  return held;
}

const existsRowsSchema = z.array(z.object({ held: z.boolean() }));

/**
 * Every admin capability some subject of the tenant holds, enabled or not:
 * what deleting the tenant takes from all of them at once, and so what a
 * caller has to hold to delete it.
 */
export async function capabilitiesHeldInTenant(
  tx: TenantScopedDatabase,
): Promise<ReadonlySet<string>> {
  const held = new Set<string>();
  for (const name of CAPABILITY_NAMES) {
    const rows = existsRowsSchema.parse(
      await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM ${holdersOf(name)} AS h) AS held`),
    );
    if (rows[0]?.held === true) held.add(name);
  }
  return held;
}

/** Whether any subject that is not disabled holds `name` effectively. */
export async function hasEnabledHolder(tx: TenantScopedDatabase, name: string): Promise<boolean> {
  const rows = existsRowsSchema.parse(
    await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${holdersOf(name)} AS h(subject_id)
        CROSS JOIN LATERAL (
          SELECT 1 FROM subjects s WHERE s.id = h.subject_id AND s.disabled_at IS NULL OFFSET 0
        ) enabled_holder
      ) AS held
    `),
  );
  return rows[0]?.held ?? false;
}

const reachRowsSchema = z.array(z.object({ root: z.string(), name: z.string() }));

// Each root's capabilities in the admin vocabulary's own order, every root
// answered, an empty list where it reaches none.
function reachByRoot(
  roots: readonly string[],
  rows: z.infer<typeof reachRowsSchema>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    roots.map((root) => {
      const names = new Set(rows.filter((row) => row.root === root).map((row) => row.name));
      return [root, ADMIN_CAPABILITIES.filter((name) => names.has(name))];
    }),
  );
}

function idList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

// `granting(role_id, name)`: every role that reaches an admin capability, with
// the capability, walked upward from the capability roles through the roles
// that nest them. The few roles that reach a capability are what a page of roles
// or groups is probed against, where walking down from the page costs the page
// times what each reaches.
export function grantingCte(): SQL {
  return sql`granting(role_id, name) AS (
      SELECT r.id, r.name
      FROM clients cl
      JOIN roles r ON r.client_id = cl.id
      WHERE cl.client_id = ${ADMIN_CLIENT_ID}
        AND r.name IN (${sql.join(
          ADMIN_CAPABILITIES.map((name) => sql`${name}`),
          sql`, `,
        )})
      UNION
      SELECT rc.parent_role_id, g.name
      FROM granting g
      CROSS JOIN LATERAL (
        SELECT parent_role_id FROM role_composites WHERE child_role_id = g.role_id OFFSET 0
      ) rc
    )`;
}

/**
 * `capabilitiesReachableFrom` for each of `roleIds` on its own, in one query
 * for a whole page: what a role's `admin_reach` reports, and so what every
 * ceiling on a write naming it will judge.
 */
export async function adminReachOfRoles(
  tx: TenantScopedDatabase,
  roleIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (roleIds.length === 0) return new Map();
  const rows = await tx.execute(sql`
    WITH RECURSIVE ${grantingCte()}
    SELECT g.role_id::text AS root, g.name AS name
    FROM granting g
    WHERE g.role_id IN (${idList(roleIds)})
  `);
  return reachByRoot(roleIds, reachRowsSchema.parse(rows));
}

/**
 * `capabilitiesOfGroupsAndAncestors` for each of `groupIds` on its own, in
 * one query for a whole page: what membership of each hands out.
 */
export async function adminReachOfGroups(
  tx: TenantScopedDatabase,
  groupIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (groupIds.length === 0) return new Map();
  // Walked from the capabilities down to the page, not from the page up: the
  // roles that reach an admin capability are few, where a page of groups can
  // map two hundred roles each. `granting` is those roles; a group reaches a
  // capability when it or an ancestor maps one, probed by (group, role).
  const rows = await tx.execute(sql`
    WITH RECURSIVE chain(root, id, parent_id) AS (
      SELECT id, id, parent_id FROM groups WHERE id IN (${idList(groupIds)})
      UNION
      SELECT ch.root, g.id, g.parent_id
      FROM chain ch
      CROSS JOIN LATERAL (
        SELECT id, parent_id FROM groups WHERE id = ch.parent_id OFFSET 0
      ) g
    ),
    ${grantingCte()}
    SELECT DISTINCT ch.root::text AS root, g.name AS name
    FROM chain ch
    CROSS JOIN granting g
    CROSS JOIN LATERAL (
      SELECT 1 FROM group_roles gr WHERE gr.group_id = ch.id AND gr.role_id = g.role_id OFFSET 0
    ) hit
  `);
  return reachByRoot(groupIds, reachRowsSchema.parse(rows));
}

/** `capabilitiesOfSubtree` in the admin vocabulary's order: a group record's `subtree_admin_reach`. */
export async function subtreeAdminReach(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<readonly string[]> {
  const reached = await capabilitiesOfSubtree(tx, groupId);
  return ADMIN_CAPABILITIES.filter((name) => reached.has(name));
}
