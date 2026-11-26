import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { withTenant } from '#/tx';

const TAG = '0150_builtin_assistant_client';

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
  name: string;
  type: string;
  secret_hash: string | null;
  builtin_assistant: boolean;
  redirect_uris: string[];
  grant_types: string[];
  auth_method: string;
  audiences: string[];
  agent_type: boolean;
}

async function assistantClients(): Promise<ClientRow[]> {
  return handle().sql<ClientRow[]>`
    select t.name as tenant, c.name, c.type, c.secret_hash, c.builtin_assistant,
           o.redirect_uris, o.grant_types, o.token_endpoint_auth_method as auth_method,
           o.audiences, o.agent_type
      from clients c
      join tenants t on t.id = c.tenant_id
      join client_oidc_config o on o.client_id = c.id
     where c.client_id = 'odudu-assistant'
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
  await runMigrations(handle().db, before);
}, 120_000);

afterAll(async () => {
  if (before !== undefined) rmSync(before, { recursive: true, force: true });
  await appHandle?.close();
  await dbHandle?.close();
  await containerHandle?.stop();
});

describe('the built-in assistant client backfill', () => {
  it('gives every existing tenant the client, skips one that holds the id, and runs again to no effect', async () => {
    const raw = handle().sql;
    await raw`insert into tenants (id, name) values
      (gen_random_uuid(), 'plain'), (gen_random_uuid(), 'taken'), (gen_random_uuid(), 'other')`;
    await raw`
      insert into clients (id, tenant_id, client_id, name, type, secret_hash)
      select gen_random_uuid(), id, 'odudu-assistant', 'Mine', 'public', null
        from tenants where name = 'taken'`;
    await raw`
      insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types,
                                      token_endpoint_auth_method)
      select c.id, c.tenant_id, ARRAY['https://mine.example/cb'], ARRAY['authorization_code'], 'none'
        from clients c where c.client_id = 'odudu-assistant'`;

    await runMigrations(handle().db, MIGRATIONS_DIR);
    const once = await assistantClients();
    expect(once.map((row) => row.tenant)).toEqual(['other', 'plain', 'taken']);

    for (const row of once.filter((r) => r.tenant !== 'taken')) {
      expect(row).toMatchObject({
        name: 'Odudu assistant',
        type: 'public',
        secret_hash: null,
        builtin_assistant: true,
        redirect_uris: [],
        grant_types: ['client_credentials'],
        auth_method: 'none',
        audiences: ['urn:odudu:params:admin-api'],
        agent_type: true,
      });
    }
    expect(once.find((r) => r.tenant === 'taken')).toMatchObject({
      name: 'Mine',
      builtin_assistant: false,
      redirect_uris: ['https://mine.example/cb'],
      agent_type: false,
    });

    await raw`delete from drizzle.__drizzle_migrations where created_at = (
      select max(created_at) from drizzle.__drizzle_migrations)`;
    await runMigrations(handle().db, MIGRATIONS_DIR);
    expect(await assistantClients()).toEqual(once);
  });

  it('allows one marked client a tenant', async () => {
    await expect(
      handle()
        .sql`insert into clients (id, tenant_id, client_id, name, type, secret_hash, builtin_assistant)
          select gen_random_uuid(), id, 'second', 'Second', 'public', null, true
            from tenants where name = 'plain'`,
    ).rejects.toThrow(/clients_one_builtin_assistant/u);
  });

  it("shows a tenant its own client and none of another's", async () => {
    const urls = containerHandle;
    if (urls === undefined) throw new Error('database not started');
    appHandle = createDatabase(await createAppRole(urls.adminUrl), { max: 2 });
    const tenants = await handle().sql<{ id: string }[]>`
      select id from tenants where name in ('plain', 'other')`;
    for (const tenant of tenants) {
      const seen = await withTenant(appHandle.db, tenant.id, (tx) =>
        tx.execute<{ tenant_id: string }>(
          sql`select tenant_id from clients where client_id = 'odudu-assistant'`,
        ),
      );
      expect(seen.map((row) => row.tenant_id)).toEqual([tenant.id]);
    }
  });

  it('leaves row security forced on the tables it touched', async () => {
    const rows = await handle().sql<{ relname: string; relforcerowsecurity: boolean }[]>`
      select relname, relforcerowsecurity from pg_class
       where relname in ('clients', 'client_oidc_config', 'tenants')`;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.relforcerowsecurity)).toBe(true);
  });
});
