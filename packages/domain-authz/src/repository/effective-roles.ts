import { type RealmScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';

export interface EffectiveRole {
  readonly roleId: string;
  readonly name: string;
  readonly clientKey: string | null;
}

interface EffectiveRoleRow {
  role_id: string;
  name: string;
  client_key: string | null;
}

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
  const rows = result as unknown as readonly EffectiveRoleRow[];

  return rows.map((row) => ({
    roleId: row.role_id,
    name: row.name,
    clientKey: row.client_key,
  }));
}
