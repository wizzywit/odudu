import type { TenantScopedDatabase } from '@odudu/db';
import { sql, type SQL } from 'drizzle-orm';

// The most lineage roots one locking statement takes.
export const LINEAGE_LOCK_BATCH = 10_000;

// The CTEs that map each grant `seedIds` selects (a query yielding `id`) to the
// root of its lineage: the topmost grant reached by following
// `exchanged_from_grant_id`. Spliced into a `with recursive` list under `name`,
// which then holds one row per (seed, root). A grant that is its own ancestor
// is taken as its own root, so the walk ends.
export function lineageRootCtes(name: string, seedIds: SQL): SQL {
  const up = sql.raw(`${name}_up`);
  const out = sql.raw(name);
  return sql`
    ${up}(seed, id, parent) as (
      select s.id, g.id, g.exchanged_from_grant_id
        from (${seedIds}) as s(id) join token_grants g on g.id = s.id
      union all
      select u.seed, p.id, p.exchanged_from_grant_id
        from ${up} u join token_grants p on p.id = u.parent
    ) cycle id set is_cycle using path,
    ${out} as (
      select distinct seed, id as root from ${up} where parent is null or is_cycle
    )`;
}

// Locks the root grant of every lineage the seeds belong to, `for no key
// update`, in id order and at most `batch` to a statement, before the caller
// touches any other row. Two revokers over one lineage then meet here and one
// waits, whatever order each takes the rest in; lineages share no rows, so
// revokers of different ones never conflict. The cost is one row per distinct
// lineage, however many grants the seeds are.
export async function lockLineageRoots(
  tx: TenantScopedDatabase,
  seedIds: SQL,
  batch = LINEAGE_LOCK_BATCH,
): Promise<void> {
  const roots = (await tx.execute(sql`
    with recursive ${lineageRootCtes('lineage', seedIds)}
    select coalesce(jsonb_agg(root order by root), '[]'::jsonb) as roots from (
      select distinct root from lineage) r`)) as unknown as { roots: string[] }[];
  const ids = roots[0]?.roots ?? [];
  for (let at = 0; at < ids.length; at += batch) {
    await tx.execute(sql`
      select id from token_grants
       where id = any(array(select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids.slice(at, at + batch))}::jsonb)))
       order by id for no key update`);
  }
}
