import { type TenantScopedDatabase } from '@odudu/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export interface EffectiveRole {
  readonly roleId: string;
  readonly name: string;
  readonly clientKey: string | null;
}

// tx.execute() returns driver rows as unknown structure; a hand-written
// interface asserted onto them is a promise the compiler enforces but
// nothing checks at runtime. Parsing narrows the actual shape instead of
// assuming it — a renamed or retyped column fails loudly here rather than
// flowing through as a malformed EffectiveRole.
export const effectiveRoleRowSchema = z.object({
  role_id: z.string(),
  name: z.string(),
  client_key: z.string().nullable(),
});
const effectiveRoleRowsSchema = z.array(effectiveRoleRowSchema);

// The roles a subject actually holds: its direct assignments, every role
// mapped to a group it belongs to or that group's ancestors (child ->
// parent, so a group's roles reach its descendants, never its ancestors),
// plus every role reachable from those via role_composites (parent grants
// child, never the reverse). UNION, not UNION ALL: verified against
// PostgreSQL 17 to terminate on a cyclic graph, where UNION ALL on the same
// data was cancelled by a statement timeout — see
// docs/superpowers/p2a-spike-log.md.
export async function effectiveRoles(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<readonly EffectiveRole[]> {
  // Lateral lookups, never joins: the planner cannot hash them against a scan of
  // the tenant's roles (docs/phases/p4d.md, "Server query plans").
  const result = await tx.execute(sql`
    ${closureOf(subjectId)}
    SELECT r.id AS role_id, r.name AS name, cl.client_id AS client_key
    FROM role_closure rc
    CROSS JOIN LATERAL (
      SELECT id, name, client_id FROM roles WHERE id = rc.role_id OFFSET 0
    ) r
    LEFT JOIN clients cl ON cl.id = r.client_id
  `);
  return effectiveRoleRowsSchema.parse(result).map(toEffectiveRole);
}

export interface EffectiveRolePage {
  /** The role id the page resumes strictly after; undefined for the first. */
  readonly after: string | undefined;
  readonly limit: number;
}

// `effectiveRoles`, `limit` of it at a time in role id order: what a listing
// answers with, where token issuance needs the whole set.
export async function effectiveRolePage(
  tx: TenantScopedDatabase,
  subjectId: string,
  page: EffectiveRolePage,
): Promise<readonly EffectiveRole[]> {
  const after = page.after === undefined ? sql`` : sql`WHERE role_id > ${page.after}::uuid`;
  const result = await tx.execute(sql`
    ${closureOf(subjectId)}
    SELECT r.id AS role_id, r.name AS name, cl.client_id AS client_key
    FROM (
      SELECT role_id FROM role_closure ${after} ORDER BY role_id LIMIT ${page.limit}::integer
    ) rc
    CROSS JOIN LATERAL (
      SELECT id, name, client_id FROM roles WHERE id = rc.role_id OFFSET 0
    ) r
    LEFT JOIN clients cl ON cl.id = r.client_id
    ORDER BY r.id
  `);
  return effectiveRoleRowsSchema.parse(result).map(toEffectiveRole);
}

// Which of `roleIds` the subject holds, effectively.
export async function heldAmong(
  tx: TenantScopedDatabase,
  subjectId: string,
  roleIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (roleIds.length === 0) return new Set();
  const ids = sql.join(
    roleIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    ${closureOf(subjectId)}
    SELECT role_id FROM role_closure WHERE role_id IN (${ids})
  `);
  return new Set(
    z
      .array(z.object({ role_id: z.string() }))
      .parse(result)
      .map((row) => row.role_id),
  );
}

function toEffectiveRole(row: z.infer<typeof effectiveRoleRowSchema>): EffectiveRole {
  return { roleId: row.role_id, name: row.name, clientKey: row.client_key };
}

// The `WITH RECURSIVE` every reading of a subject's roles starts from,
// ending in `role_closure`.
function closureOf(subjectId: string): SQL {
  return sql`
    WITH RECURSIVE group_closure AS (
      SELECT g.id, g.parent_id
      FROM subject_groups sg
      CROSS JOIN LATERAL (
        SELECT id, parent_id FROM groups WHERE id = sg.group_id OFFSET 0
      ) g
      WHERE sg.subject_id = ${subjectId}
      UNION
      SELECT p.id, p.parent_id
      FROM group_closure c
      CROSS JOIN LATERAL (
        SELECT id, parent_id FROM groups WHERE id = c.parent_id OFFSET 0
      ) p
    ),
    seed_roles AS (
      SELECT role_id FROM subject_roles WHERE subject_id = ${subjectId}
      UNION
      SELECT gr.role_id
      FROM group_closure gc
      CROSS JOIN LATERAL (
        SELECT role_id FROM group_roles WHERE group_id = gc.id OFFSET 0
      ) gr
    ),
    role_closure AS (
      SELECT role_id FROM seed_roles
      UNION
      SELECT rc.child_role_id AS role_id
      FROM role_closure c
      CROSS JOIN LATERAL (
        SELECT child_role_id FROM role_composites WHERE parent_role_id = c.role_id OFFSET 0
      ) rc
    )`;
}

// The capability closure of an explicit set of role ids: each one plus
// every role `role_composites` reaches from it (parent grants child) — the
// same traversal `effectiveRoles` walks from a subject's own assignments,
// seeded here from a given id list instead. What the admin API's capability
// ceiling compares a requested role set, and a caller's own, against: a
// composite that nests a capability rather than naming it directly must
// still be caught, and a name-only comparison would miss it.
export async function rolesReachableFrom(
  tx: TenantScopedDatabase,
  roleIds: readonly string[],
): Promise<readonly EffectiveRole[]> {
  if (roleIds.length === 0) return [];
  // Lateral lookups, never joins: the planner cannot hash them against a scan of
  // the tenant's roles (docs/phases/p4d.md, "Server query plans").
  const idList = sql.join(
    roleIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    WITH RECURSIVE closure(role_id) AS (
      SELECT id AS role_id FROM roles WHERE id IN (${idList})
      UNION
      SELECT rc.child_role_id AS role_id
      FROM closure c
      CROSS JOIN LATERAL (
        SELECT child_role_id FROM role_composites WHERE parent_role_id = c.role_id OFFSET 0
      ) rc
    )
    SELECT r.id AS role_id, r.name AS name, cl.client_id AS client_key
    FROM closure c
    CROSS JOIN LATERAL (
      SELECT id, name, client_id FROM roles WHERE id = c.role_id OFFSET 0
    ) r
    LEFT JOIN clients cl ON cl.id = r.client_id
  `);
  const rows = effectiveRoleRowsSchema.parse(result);

  return rows.map((row) => ({
    roleId: row.role_id,
    name: row.name,
    clientKey: row.client_key,
  }));
}
