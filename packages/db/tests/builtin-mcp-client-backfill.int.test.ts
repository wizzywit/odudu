import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { withTenant } from '#/tx';

const TAG = '0114_builtin_mcp_client';

let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let before: string | undefined;

function handle(): DatabaseHandle {
  if (dbHandle === undefined) throw new Error('database not started');
  return dbHandle;
}

interface ClientRow {
  tenant: string;
  id: string;
  name: string;
  type: string;
  secret_hash: string | null;
  builtin_mcp: boolean;
  redirect_uris: string[];
  grant_types: string[];
  auth_method: string;
  audiences: string[];
  consent_required: boolean;
  assignments: Record<string, string>;
}

async function mcpClients(): Promise<ClientRow[]> {
  return handle().sql<ClientRow[]>`
    select t.name as tenant, c.id, c.name, c.type, c.secret_hash, c.builtin_mcp,
           o.redirect_uris, o.grant_types, o.token_endpoint_auth_method as auth_method,
           o.audiences, o.consent_required,
           coalesce((select jsonb_object_agg(s.name, a.assignment)
                       from client_scope_assignments a
                       join client_scopes s on s.id = a.client_scope_id
                      where a.client_id = c.id), '{}'::jsonb) as assignments
      from clients c
      join tenants t on t.id = c.tenant_id
      join client_oidc_config o on o.client_id = c.id
     where c.client_id = 'odudu-mcp'
     order by t.name`;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  dbHandle = createDatabase(containerHandle.adminUrl);

  // The migrations before the one under test, so tenants exist without the client.
  before = mkdtempSync(join(tmpdir(), 'odudu-migrations-'));
  cpSync(MIGRATIONS_DIR, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.tag < TAG);
  writeFileSync(journalPath, JSON.stringify(journal));
  await runMigrations(dbHandle.db, before);
}, 120_000);

afterAll(async () => {
  if (before !== undefined) rmSync(before, { recursive: true, force: true });
  await appHandle?.close();
  await dbHandle?.close();
  await containerHandle?.stop();
});

describe('the built-in MCP client backfill', () => {
  it('gives every existing tenant the client, skips one that holds the id, and runs again to no effect', async () => {
    const raw = handle().sql;
    await raw`insert into tenants (id, name) values
      (gen_random_uuid(), 'plain'), (gen_random_uuid(), 'taken'), (gen_random_uuid(), 'bare')`;
    // 'plain' and 'taken' have the scope vocabulary; 'bare' has none.
    await raw`
      insert into client_scopes (id, tenant_id, name, default_client_assignment)
      select gen_random_uuid(), t.id, s.name, s.assignment
        from tenants t
       cross join (values ('openid', 'default'), ('profile', 'default'),
                          ('offline_access', 'optional'),
                          ('mcp:read', null), ('mcp:write', null)) as s (name, assignment)
       where t.name in ('plain', 'taken')`;
    await raw`
      insert into clients (id, tenant_id, client_id, name, type, secret_hash)
      select gen_random_uuid(), id, 'odudu-mcp', 'Mine', 'public', null
        from tenants where name = 'taken'`;
    await raw`
      insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types,
                                      token_endpoint_auth_method)
      select c.id, c.tenant_id, ARRAY['https://mine.example/cb'], ARRAY['authorization_code'], 'none'
        from clients c where c.client_id = 'odudu-mcp'`;

    await runMigrations(handle().db, MIGRATIONS_DIR);
    const once = await mcpClients();
    expect(once.map((row) => row.tenant)).toEqual(['bare', 'plain', 'taken']);

    for (const row of once.filter((r) => r.tenant !== 'taken')) {
      expect(row).toMatchObject({
        name: 'Odudu MCP',
        type: 'public',
        secret_hash: null,
        builtin_mcp: true,
        redirect_uris: ['http://127.0.0.1', 'http://[::1]'],
        grant_types: ['authorization_code', 'refresh_token'],
        auth_method: 'none',
        audiences: ['urn:odudu:params:admin-api'],
        consent_required: true,
      });
    }
    expect(once.find((r) => r.tenant === 'bare')?.assignments).toEqual({});
    expect(once.find((r) => r.tenant === 'plain')?.assignments).toEqual({
      openid: 'default',
      profile: 'default',
      offline_access: 'optional',
      'mcp:read': 'default',
      'mcp:write': 'optional',
    });
    const taken = once.find((r) => r.tenant === 'taken');
    expect(taken).toMatchObject({
      name: 'Mine',
      builtin_mcp: false,
      redirect_uris: ['https://mine.example/cb'],
      assignments: {},
    });

    await raw`delete from drizzle.__drizzle_migrations where created_at = (
      select max(created_at) from drizzle.__drizzle_migrations)`;
    await runMigrations(handle().db, MIGRATIONS_DIR);
    expect(await mcpClients()).toEqual(once);
  });

  it('allows one marked client a tenant', async () => {
    const raw = handle().sql;
    await expect(
      raw`insert into clients (id, tenant_id, client_id, name, type, secret_hash, builtin_mcp)
          select gen_random_uuid(), id, 'second', 'Second', 'public', null, true
            from tenants where name = 'plain'`,
    ).rejects.toThrow(/clients_one_builtin_mcp/u);
  });

  it("shows a tenant its own client and none of another's", async () => {
    const urls = containerHandle;
    if (urls === undefined) throw new Error('database not started');
    appHandle = createDatabase(await createAppRole(urls.adminUrl), { max: 2 });
    const tenants = await handle().sql<{ id: string; name: string }[]>`
      select id, name from tenants where name in ('plain', 'bare')`;
    for (const tenant of tenants) {
      const seen = await withTenant(appHandle.db, tenant.id, (tx) =>
        tx.execute<{ tenant_id: string }>(
          sql`select tenant_id from clients where client_id = 'odudu-mcp'`,
        ),
      );
      expect(seen.map((row) => row.tenant_id)).toEqual([tenant.id]);
    }
  });

  it('leaves row security forced on the three tables', async () => {
    const rows = await handle().sql<{ relname: string; relforcerowsecurity: boolean }[]>`
      select relname, relforcerowsecurity from pg_class
       where relname in ('clients', 'client_oidc_config', 'client_scope_assignments')`;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.relforcerowsecurity)).toBe(true);
  });
});
