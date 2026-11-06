import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

const TAG = '0122_service_accounts_by_grant';

let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;
let before: string | undefined;

function handle(): DatabaseHandle {
  if (dbHandle === undefined) throw new Error('database not started');
  return dbHandle;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  dbHandle = createDatabase(containerHandle.adminUrl);
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
  await dbHandle?.close();
  await containerHandle?.stop();
});

interface Outcome {
  client: string;
  subject: boolean;
  idle: boolean;
}

async function outcomes(): Promise<Outcome[]> {
  return handle().sql<Outcome[]>`
    select t.name || '/' || c.client_id as client,
           c.service_subject_id is not null as subject,
           c.service_account_idle as idle
      from clients c join tenants t on t.id = c.tenant_id
     where c.client_id like 'k-%'
     order by 1`;
}

async function seed(): Promise<void> {
  const raw = handle().sql;
  await raw`insert into tenants (id, name) values (gen_random_uuid(), 'one'), (gen_random_uuid(), 'two')`;
  // keeps: has the grant. gone: none and nothing names it.
  // grant/role/audit/consent: none, but something does.
  const specs: { client: string; grants: string[]; type: string; account: boolean }[] = [
    { client: 'k-keeps', grants: ['client_credentials'], type: 'confidential', account: true },
    { client: 'k-gone', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-grant', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-role', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-audit', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-consent', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-public', grants: ['authorization_code'], type: 'public', account: false },
    { client: 'k-bare', grants: ['authorization_code'], type: 'confidential', account: false },
  ];
  for (const spec of specs) {
    await raw`
      with s as (
        insert into subjects (id, tenant_id, type)
        select gen_random_uuid(), t.id, 'service' from tenants t
         where t.name in ('one', 'two') and ${spec.account}
        returning id, tenant_id)
      insert into clients (id, tenant_id, client_id, name, type, secret_hash, service_subject_id)
      select gen_random_uuid(), t.id, ${spec.client}, ${spec.client}, ${spec.type},
             case when ${spec.type} = 'confidential' then 'x' end,
             (select s.id from s where s.tenant_id = t.id)
        from tenants t where t.name in ('one', 'two')`;
    await raw`
      insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types,
                                      token_endpoint_auth_method)
      select c.id, c.tenant_id, ARRAY['https://a.example/cb'], ${spec.grants},
             case when c.type = 'public' then 'none' else 'client_secret_basic' end
        from clients c where c.client_id = ${spec.client}`;
  }
  await raw`
    insert into token_grants (id, tenant_id, client_id, subject_id, scope)
    select gen_random_uuid(), c.tenant_id, c.id, c.service_subject_id, 'x'
      from clients c where c.client_id = 'k-grant'`;
  await raw`
    with r as (insert into roles (id, tenant_id, name)
               select gen_random_uuid(), c.tenant_id, 'r-' || c.tenant_id
                 from clients c where c.client_id = 'k-role' returning id, tenant_id)
    insert into subject_roles (tenant_id, subject_id, role_id)
    select c.tenant_id, c.service_subject_id, r.id
      from clients c join r on r.tenant_id = c.tenant_id where c.client_id = 'k-role'`;
  await raw`
    insert into audit_events (id, tenant_id, event_type, action, outcome, actor_subject_id)
    select gen_random_uuid(), c.tenant_id, 'admin', 'client.amend', 'allowed', c.service_subject_id
      from clients c where c.client_id = 'k-audit'`;
  await raw`
    insert into consents (id, tenant_id, subject_id, client_id)
    select gen_random_uuid(), c.tenant_id, c.service_subject_id, c.id
      from clients c where c.client_id = 'k-consent'`;
}

describe('the service-account migration', () => {
  it('deletes the accounts nothing names, keeps the rest and marks them, and runs again to no effect', async () => {
    await seed();
    await runMigrations(handle().db, MIGRATIONS_DIR);
    const once = await outcomes();
    const expected = (name: string, subject: boolean, idle: boolean): Outcome[] =>
      ['one', 'two'].map((tenant) => ({ client: `${tenant}/${name}`, subject, idle }));
    expect(once).toEqual(
      [
        ...expected('k-audit', true, true),
        ...expected('k-bare', false, false),
        ...expected('k-consent', true, true),
        ...expected('k-gone', false, false),
        ...expected('k-grant', true, true),
        ...expected('k-keeps', true, false),
        ...expected('k-public', false, false),
        ...expected('k-role', true, true),
      ].sort((a, b) => (a.client < b.client ? -1 : a.client > b.client ? 1 : 0)),
    );

    await handle().sql`delete from drizzle.__drizzle_migrations where created_at = (
      select max(created_at) from drizzle.__drizzle_migrations)`;
    await runMigrations(handle().db, MIGRATIONS_DIR);
    expect(await outcomes()).toEqual(once);
  });

  it('leaves no service subject behind that no client points at', async () => {
    const rows = await handle().sql<{ n: number }[]>`
      select count(*)::int as n from subjects s
       where s.type = 'service'
         and not exists (select 1 from clients c where c.service_subject_id = s.id)`;
    expect(rows[0]?.n).toBe(0);
  });

  it('leaves row security forced on every table it read', async () => {
    const rows = await handle().sql<{ relname: string }[]>`
      select relname from pg_class
       where relname in ('clients', 'subjects', 'client_oidc_config', 'audit_events',
                         'token_grants', 'subject_roles', 'consents', 'sessions')
         and not relforcerowsecurity`;
    expect(rows).toEqual([]);
  });

  it('indexes the marked clients', async () => {
    const rows = await handle().sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes where indexname = 'clients_idle_service_account'`;
    expect(rows[0]?.indexdef).toContain('WHERE service_account_idle');
  });
});
