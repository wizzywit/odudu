import { type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';
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
  const result = await tx.execute(sql`
    WITH RECURSIVE group_closure AS (
      SELECT g.id, g.parent_id
      FROM groups g
      JOIN subject_groups sg ON sg.group_id = g.id
      WHERE sg.subject_id = ${subjectId}
      UNION
      SELECT p.id, p.parent_id
      FROM groups p
      JOIN group_closure c ON p.id = c.parent_id
    ),
    seed_roles AS (
      SELECT role_id FROM subject_roles WHERE subject_id = ${subjectId}
      UNION
      SELECT gr.role_id FROM group_roles gr JOIN group_closure gc ON gc.id = gr.group_id
    ),
    role_closure AS (
      SELECT role_id FROM seed_roles
      UNION
      SELECT rc.child_role_id AS role_id
      FROM role_composites rc
      JOIN role_closure c ON rc.parent_role_id = c.role_id
    )
    SELECT r.id AS role_id, r.name AS name, cl.client_id AS client_key
    FROM role_closure rc
    JOIN roles r ON r.id = rc.role_id
    LEFT JOIN clients cl ON cl.id = r.client_id
  `);
  const rows = effectiveRoleRowsSchema.parse(result);

  return rows.map((row) => ({
    roleId: row.role_id,
    name: row.name,
    clientKey: row.client_key,
  }));
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
  const idList = sql.join(
    roleIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    WITH RECURSIVE closure(role_id) AS (
      SELECT id AS role_id FROM roles WHERE id IN (${idList})
      UNION
      SELECT rc.child_role_id AS role_id
      FROM role_composites rc
      JOIN closure c ON rc.parent_role_id = c.role_id
    )
    SELECT r.id AS role_id, r.name AS name, cl.client_id AS client_key
    FROM closure c
    JOIN roles r ON r.id = c.role_id
    LEFT JOIN clients cl ON cl.id = r.client_id
  `);
  const rows = effectiveRoleRowsSchema.parse(result);

  return rows.map((row) => ({
    roleId: row.role_id,
    name: row.name,
    clientKey: row.client_key,
  }));
}
