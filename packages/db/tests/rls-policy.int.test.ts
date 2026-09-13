import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

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

interface PolicyRow {
  tablename: string;
  policyname: string;
  qual: string | null;
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
      -- 'r' (ordinary table) and 'p' (partitioned table) are both in scope:
      -- a tenant table declared as partitioned has relkind = 'p' and would
      -- otherwise ship with no RLS and no failure here.
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

  it('every policy on a checked table actually filters by app.realm_id', async () => {
    // Counting policies (test above) passes for a policy that exists but
    // never references app.realm_id — e.g. `USING (true)` — which forces
    // RLS and satisfies "at least one policy" while filtering nothing.
    // Inspecting pg_policies.qual is what tells a decorative policy apart
    // from one that actually scopes rows to a tenant.
    const rows = await handle.sql<TableRlsRow[]>`
      select
        c.relname as table_name,
        (
          select count(*)::int
          from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
        ) as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    `;
    const checkedTables = rows
      .filter((row) => !RLS_EXEMPT_TABLES.has(row.table_name))
      .map((row) => row.table_name);

    expect(checkedTables.length).toBeGreaterThan(0);

    const policies = await handle.sql<PolicyRow[]>`
      select tablename, policyname, qual
      from pg_policies
      where schemaname = 'public' and tablename = any(${checkedTables})
    `;

    for (const table of checkedTables) {
      const tablePolicies = policies.filter((p) => p.tablename === table);
      expect.soft(tablePolicies.length, `${table}: has at least one policy`).toBeGreaterThan(0);
      for (const policy of tablePolicies) {
        expect
          .soft(policy.qual ?? '', `${table}.${policy.policyname}: qual references app.realm_id`)
          .toContain('app.realm_id');
      }
    }
  });
});
