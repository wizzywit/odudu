import { type RealmScopedDatabase } from '@odudu/db';
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

// The roles a subject actually holds: its direct assignments plus every
// role reachable by following role_composites (a parent grants its
// children, never the reverse). UNION, not UNION ALL: verified against
// PostgreSQL 17 to terminate on a cyclic composite graph, because
// duplicates are discarded and the frontier of genuinely new rows empties —
// UNION ALL on the same cyclic data was cancelled by a statement timeout.
// See docs/superpowers/p2a-spike-log.md.
export async function effectiveRoles(
  tx: RealmScopedDatabase,
  subjectId: string,
): Promise<readonly EffectiveRole[]> {
  const result = await tx.execute(sql`
    WITH RECURSIVE seed_roles AS (
      SELECT role_id FROM subject_roles WHERE subject_id = ${subjectId}
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
