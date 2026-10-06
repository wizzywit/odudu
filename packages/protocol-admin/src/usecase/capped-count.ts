import { type TenantScopedDatabase } from '@odudu/db';
import { count, sql, type SQL } from 'drizzle-orm';
import { type PgTable } from 'drizzle-orm/pg-core';

// Counting stops one row past this, so a count reads at most that many
// rows however large the collection, and says `capped` rather than guess.
// A list's count keeps the list's own ORDER BY; this one does not, since
// ordering by a column the filter does not lead with makes the planner walk
// that order and discard rows until the LIMIT, unbounded when matches are sparse.
export const COUNT_CAP = 10_000;

/**
 * How many rows of `table` match `where`, no more than `cap`: for the
 * counts a write reports, where a number past the ceiling says no more than
 * the ceiling does.
 */
export async function countAtMost(
  tx: TenantScopedDatabase,
  source: { readonly table: PgTable; readonly where: SQL | undefined },
  cap: number = COUNT_CAP,
): Promise<number> {
  const matching = tx
    .select({ one: sql<number>`1`.as('one') })
    .from(source.table)
    .where(source.where)
    .limit(cap + 1)
    .as('matching');
  const rows = await tx.select({ n: count() }).from(matching);
  return Math.min(rows[0]?.n ?? 0, cap);
}
