import { type DatabaseHandle } from '@odudu/db';

export interface UnindexedForeignKey {
  readonly table: string;
  readonly constraint: string;
  readonly columns: string;
  readonly references: string;
}

// A parent row's delete, or its key's update, looks its children up by the
// referencing columns; with no index to find them by, every such statement
// reads the child table whole. A foreign key is served when an index leads
// with its columns, or with any one of them but the tenant (a composite
// key's lookups probe the one that selects), and a partial index counts when
// it only excludes null, which an equality never matches.
export async function unindexedForeignKeys(owner: DatabaseHandle): Promise<UnindexedForeignKey[]> {
  return owner.sql<UnindexedForeignKey[]>`
    with fks as (
      select c.conrelid, c.conname, c.confrelid, c.conkey as every_column,
             array(select k.attnum
                     from unnest(c.conkey) k(attnum)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                    where cardinality(c.conkey) = 1 or a.attname <> 'tenant_id') as probed_columns,
             (select string_agg(a.attname, ', ')
                from unnest(c.conkey) k(attnum)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns
        from pg_constraint c
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace)
    select f.conrelid::regclass::text as "table", f.conname as constraint,
           f.columns, f.confrelid::regclass::text as references
      from fks f
     where not exists (
       select 1
         from pg_index i
        where i.indrelid = f.conrelid
          and (i.indpred is null or pg_get_expr(i.indpred, i.indrelid) ~ 'IS NOT NULL')
          and ((i.indkey::int2[])[0] = any (f.probed_columns)
               or (select array_agg(x order by x)
                     from unnest((i.indkey::int2[])[0:cardinality(f.every_column) - 1]) x)
                  = (select array_agg(x order by x) from unnest(f.every_column) x)))
     order by 1, 2`;
}
