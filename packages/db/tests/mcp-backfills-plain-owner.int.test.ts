import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

const TAG = '0113_mcp_scopes';
const TOUCHED = [
  'tenants',
  'client_scopes',
  'clients',
  'client_oidc_config',
  'client_scope_assignments',
];

let container: TestDatabase | undefined;
let admin: DatabaseHandle | undefined;
let owner: DatabaseHandle | undefined;
let before: string | undefined;

// The branch of 0113 and 0114 that lifts FORCE ROW LEVEL SECURITY runs only
// for a migrating role that is neither SUPERUSER nor BYPASSRLS, which the
// other backfill tests (run as the container's superuser) never are.
beforeAll(async () => {
  container = await startTestDatabase();
  admin = createDatabase(container.adminUrl);
  await admin.sql`CREATE ROLE plain_owner LOGIN CREATEROLE PASSWORD 'plain_owner'`;
  await admin.sql`GRANT ALL ON SCHEMA public TO plain_owner`;
  await admin.sql`GRANT CREATE ON DATABASE test TO plain_owner`;
  const url = new URL(container.adminUrl);
  url.username = 'plain_owner';
  url.password = 'plain_owner';
  owner = createDatabase(url.toString());

  before = mkdtempSync(join(tmpdir(), 'odudu-migrations-'));
  cpSync(MIGRATIONS_DIR, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < TAG);
  writeFileSync(journalPath, JSON.stringify(journal));
  await runMigrations(owner.db, before);
}, 180_000);

afterAll(async () => {
  if (before !== undefined) rmSync(before, { recursive: true, force: true });
  await owner?.close();
  await admin?.close();
  await container?.stop();
});

describe('the MCP backfills under an owner row security applies to', () => {
  it('gives every tenant the scopes and the built-in client, and forces row security again', async () => {
    if (owner === undefined || admin === undefined) throw new Error('not started');
    const role = await owner.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await admin.sql`insert into tenants (id, name) values
      (gen_random_uuid(), 'one'), (gen_random_uuid(), 'two')`;
    await admin.sql`
      insert into client_scopes (id, tenant_id, name, default_client_assignment)
      select gen_random_uuid(), id, s.name, s.assignment
        from tenants cross join (values ('openid', 'default')) as s (name, assignment)`;

    await runMigrations(owner.db, MIGRATIONS_DIR);

    const scopes = await admin.sql<{ tenant: string; name: string }[]>`
      select t.name as tenant, s.name from client_scopes s join tenants t on t.id = s.tenant_id
       where s.name in ('mcp:read', 'mcp:write') order by 1, 2`;
    expect(scopes.map((row) => `${row.tenant}/${row.name}`)).toEqual([
      'one/mcp:read',
      'one/mcp:write',
      'two/mcp:read',
      'two/mcp:write',
    ]);
    const clients = await admin.sql<{ tenant: string; assignments: Record<string, string> }[]>`
      select t.name as tenant,
             (select jsonb_object_agg(s.name, a.assignment)
                from client_scope_assignments a join client_scopes s on s.id = a.client_scope_id
               where a.client_id = c.id) as assignments
        from clients c join tenants t on t.id = c.tenant_id
        join client_oidc_config o on o.client_id = c.id
       where c.builtin_mcp order by 1`;
    expect(clients).toEqual(
      ['one', 'two'].map((tenant) => ({
        tenant,
        assignments: { openid: 'default', 'mcp:read': 'default', 'mcp:write': 'optional' },
      })),
    );
    const notForced = await admin.sql<{ relname: string }[]>`
      select relname from pg_class
       where relname in ${admin.sql(TOUCHED)} and not relforcerowsecurity`;
    expect(notForced).toEqual([]);
  });
});
