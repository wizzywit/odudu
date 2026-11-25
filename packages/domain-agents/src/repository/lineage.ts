import type { TenantScopedDatabase } from '@odudu/db';
import { sql, type SQL } from 'drizzle-orm';

// The most lineage roots one locking statement takes.
export const LINEAGE_LOCK_BATCH = 10_000;

// How many walks a call makes at most: one that locks and one that confirms,
// with two more for a root that changed while it waited.
const LINEAGE_LOCK_ATTEMPTS = 4;

// The CTEs that map each grant `seedIds` selects (a query yielding `id`) to the
// root of its lineage: the topmost existing grant reached by following
// `exchanged_from_grant_id`. A grant is a root when it names no parent (the
// foreign key is `ON DELETE SET NULL`, so deleting an ancestor clears it), when
// the parent row is missing (defensive), or when it is its own ancestor.
// Spliced into a `with recursive` list under `name`, which then holds one row
// per (seed, root).
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
      select distinct seed, id as root from ${up}
       where parent is null or is_cycle
          or not exists (select 1 from token_grants q where q.id = parent)
    )`;
}

// Locks the root grant of every lineage the seeds belong to, `for no key
// update`, in id order and at most `batch` to a statement, before the caller
// touches any other row; returns the roots of the last walk. Two revokers over
// one lineage meet at its root and one waits; lineages share no rows. The cost
// is one row per distinct lineage. A walk is one statement, seeds times chain
// depth rows, and each call makes at least two: after locking, the walk is
// repeated, because a middle grant deleted while the call waited makes a
// descendant its own root, and any root not yet held is locked too. Nothing
// detaches a lineage while its root is held, so a walk that adds nothing is
// final. A root locked this late is out of id order; the attempts are bounded
// and the last one throws rather than go on unlocked.
export async function lockLineageRoots(
  tx: TenantScopedDatabase,
  seedIds: SQL,
  batch = LINEAGE_LOCK_BATCH,
): Promise<string[]> {
  const held = new Set<string>();
  for (let attempt = 0; attempt < LINEAGE_LOCK_ATTEMPTS; attempt += 1) {
    const walked = (await tx.execute(sql`
      with recursive ${lineageRootCtes('lineage', seedIds)}
      select coalesce(jsonb_agg(root order by root), '[]'::jsonb) as roots from (
        select distinct root from lineage) r`)) as unknown as { roots: string[] }[];
    const ids = walked[0]?.roots ?? [];
    const todo = ids.filter((id) => !held.has(id));
    if (todo.length === 0) return ids;
    for (let at = 0; at < todo.length; at += batch) {
      const rows = (await tx.execute(sql`
        select id from token_grants
         where id = any(array(select value::uuid from jsonb_array_elements_text(${JSON.stringify(todo.slice(at, at + batch))}::jsonb)))
         order by id for no key update`)) as unknown as { id: string }[];
      for (const row of rows) held.add(row.id);
    }
  }
  throw new Error('the lineage roots kept changing while they were being locked');
}
