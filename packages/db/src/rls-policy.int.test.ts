import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client.js';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate.js';

// Tables that legitimately have no realm-scoped RLS policy. Kept explicit and
// short: drizzle's own migration bookkeeping table lives in the "drizzle"
// schema today (out of scope of the `public`-only query below), but it is
// listed here too in case that ever changes, so this test stays a red flag
// rather than a silent no-op.
const RLS_EXEMPT_TABLES = new Set(['__drizzle_migrations']);

interface TableRlsRow {
  table_name: string;
  row_security_enabled: boolean;
  row_security_forced: boolean;
  policy_count: number;
}

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
});

afterAll(async () => {
  await dbHandle?.close();
  await containerHandle?.stop();
});

describe('row-level security coverage', () => {
  it('forces RLS with at least one policy on every table in the public schema', async () => {
    // ALTER DEFAULT PRIVILEGES automates the GRANT half for every future
    // table; ENABLE/FORCE ROW LEVEL SECURITY plus a policy stays per-table
    // and manual. This turns "a later migration forgot the policy" from a
    // silent leak into a failing assertion on every PR.
    const rows = await handle.sql<TableRlsRow[]>`
      select
        c.relname as table_name,
        c.relrowsecurity as row_security_enabled,
        c.relforcerowsecurity as row_security_forced,
        (
          select count(*)::int
          from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
        ) as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `;

    const checked = rows.filter((row) => !RLS_EXEMPT_TABLES.has(row.table_name));

    expect(checked.length).toBeGreaterThan(0);

    for (const row of checked) {
      expect.soft(row.row_security_enabled, `${row.table_name}: relrowsecurity`).toBe(true);
      expect.soft(row.row_security_forced, `${row.table_name}: relforcerowsecurity`).toBe(true);
      expect.soft(row.policy_count, `${row.table_name}: pg_policies count`).toBeGreaterThan(0);
    }
  });
});
