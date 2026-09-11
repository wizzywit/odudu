import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

// Drizzle's own migration bookkeeping table has no tenant data and no
// realm_id column; every other table in public is a tenant table.
const EXEMPT = new Set(['__drizzle_migrations']);

let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let handle: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  dbHandle = createDatabase(container.adminUrl);
  handle = dbHandle;
  await runMigrations(handle.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await dbHandle?.close();
  await containerHandle?.stop();
});

it('every table in public is force-RLS with at least one policy', async () => {
  const rows = await handle.db.execute(sql`
    select c.relname             as table_name,
           c.relrowsecurity      as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           count(p.policyname)   as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
     where n.nspname = 'public' and c.relkind = 'r'
     group by 1, 2, 3
     order by 1
  `);

  const offenders = (
    rows as unknown as {
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policies: string;
    }[]
  )
    .filter((r) => !EXEMPT.has(r.table_name))
    .filter((r) => !r.rls_enabled || !r.rls_forced || Number(r.policies) === 0);

  expect(offenders).toEqual([]);
});
