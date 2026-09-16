import { sql } from 'drizzle-orm';
import { type DatabaseHandle } from '#/client';

interface BypassRow extends Record<string, unknown> {
  bypasses: boolean;
}

/**
 * Whether this connection's role escapes row-level security outright. Asked
 * of Postgres rather than inferred from a query that came back empty, which
 * is the same fact arriving too late to act on. A role with BYPASSRLS and
 * not SUPERUSER is the one combination no test exercises; it rests on
 * documented semantics, and the disjunction can only err towards accepting
 * a role that then reads nothing, which a caller reports rather than
 * swallows.
 */
export async function bypassesRowLevelSecurity(handle: DatabaseHandle): Promise<boolean> {
  const rows = await handle.db.execute<BypassRow>(
    sql`SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user`,
  );
  return rows[0]?.bypasses === true;
}
