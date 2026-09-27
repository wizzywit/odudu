import { type TenantScopedDatabase } from '@odudu/db';
import { lt, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { prefixUpperBound } from '#/service/list-query';

/** The last row a searched page returned: its id and its search key. */
export interface SearchPosition {
  readonly id: string;
  readonly sort: string;
}

type Executor = Pick<TenantScopedDatabase, 'execute'>;

// Folded by PostgreSQL, in the collation that filled the search column, so
// the bound and the stored key cannot fold differently.
async function foldedByDatabase(db: Executor, prefix: string): Promise<string> {
  const rows = await db.execute(sql`select lower(${prefix}) as folded`);
  const folded: unknown = rows[0]?.folded;
  if (typeof folded !== 'string') throw new Error('protocol-admin: lower() returned no text');
  return folded;
}

// The rows of `key` (a stored `COLLATE "C"` lower() column) that start with
// `prefix`, past `after` in `(key, id)` order. Every condition is a plain
// comparison on the indexed columns, which row-level security leaves in the
// index condition (docs/phases/p4d.md, "Prefix search as one range scan").
export async function prefixRangeConditions(
  db: Executor,
  key: AnyColumn,
  id: AnyColumn,
  prefix: string,
  after: SearchPosition | undefined,
): Promise<SQL[]> {
  const upper = prefixUpperBound(await foldedByDatabase(db, prefix));
  return [
    sql`${key} >= lower(${prefix})`,
    ...(upper === null ? [] : [lt(key, upper)]),
    ...(after === undefined ? [] : [sql`(${key}, ${id}) > (${after.sort}, ${after.id})`]),
  ];
}

export function requireSearchKey(value: string | null): string {
  if (value === null) throw new Error('protocol-admin: a searched row carried no search key');
  return value;
}
