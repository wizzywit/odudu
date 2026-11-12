import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { withTenant } from '#/tx';

let container: TestDatabase | undefined;
let db: DatabaseHandle | undefined;
let appDb: DatabaseHandle | undefined;
let tenantId = '';
let otherTenantId = '';
let subjectId = '';

function handle(): DatabaseHandle {
  if (db === undefined) throw new Error('database not started');
  return db;
}

beforeAll(async () => {
  container = await startTestDatabase();
  db = createDatabase(container.adminUrl);
  await runMigrations(db.db, MIGRATIONS_DIR);
  const tenants = await db.sql<{ id: string }[]>`
    insert into tenants (id, name) values (gen_random_uuid(), 'terms'), (gen_random_uuid(), 'other')
    returning id`;
  tenantId = tenants[0]?.id ?? '';
  otherTenantId = tenants[1]?.id ?? '';
  const subjects = await db.sql<{ id: string }[]>`
    insert into subjects (id, tenant_id, type) values (gen_random_uuid(), ${tenantId}, 'user')
    returning id`;
  subjectId = subjects[0]?.id ?? '';
}, 180_000);

afterAll(async () => {
  await appDb?.close();
  await db?.close();
  await container?.stop();
});

describe('the tenant terms settings', () => {
  it('start with no address and version 1', async () => {
    const rows = await handle().sql<{ terms_uri: string | null; terms_version: string }[]>`
      select terms_uri, terms_version from tenants where id = ${tenantId}`;
    expect(rows).toEqual([{ terms_uri: null, terms_version: '1' }]);
  });

  it('refuse a version that is empty or longer than 64 characters', async () => {
    await expect(
      handle().sql`update tenants set terms_version = '' where id = ${tenantId}`,
    ).rejects.toMatchObject({ constraint_name: 'tenants_terms_version_length' });
    await expect(
      handle().sql`update tenants set terms_version = ${'x'.repeat(65)} where id = ${tenantId}`,
    ).rejects.toMatchObject({ constraint_name: 'tenants_terms_version_length' });
    await handle().sql`update tenants set terms_version = ${'x'.repeat(64)} where id = ${tenantId}`;
    await handle().sql`update tenants set terms_version = '1' where id = ${tenantId}`;
  });
});

describe('user_required_actions', () => {
  async function owe(action: string): Promise<void> {
    await handle().sql`
      insert into user_required_actions (tenant_id, subject_id, action)
      values (${tenantId}, ${subjectId}, ${action})
      on conflict do nothing`;
  }

  it('takes the three new actions', async () => {
    await owe('verify-email');
    await owe('update-profile');
    await owe('accept-terms');
  });

  it('still refuses a name it does not know', async () => {
    await expect(owe('accept-tos')).rejects.toMatchObject({
      constraint_name: 'user_required_actions_action',
    });
  });
});

describe('client_oidc_config.allowed_actions', () => {
  beforeAll(async () => {
    await handle().sql`insert into clients (id, tenant_id, client_id, name, type)
      values (gen_random_uuid(), ${tenantId}, 'pub', 'Pub', 'public')`;
    await handle()
      .sql`insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method)
      select id, tenant_id, ARRAY['https://a.example/cb'], ARRAY['authorization_code'], 'none'
        from clients where tenant_id = ${tenantId}`;
  });

  async function setActions(actions: string[]): Promise<void> {
    await handle().sql`update client_oidc_config set allowed_actions = ${actions}::text[]
      where tenant_id = ${tenantId}`;
  }

  it('takes the two an application may start', async () => {
    await setActions(['verify-email', 'update-profile']);
    await setActions([]);
  });

  it('refuses the tenant terms, which only the tenant asks for', async () => {
    await expect(setActions(['accept-terms'])).rejects.toMatchObject({
      constraint_name: 'client_oidc_config_allowed_actions_check',
    });
  });
});

describe('subject_terms_acceptances', () => {
  async function accept(version: string): Promise<void> {
    await handle().sql`
      insert into subject_terms_acceptances (tenant_id, subject_id, version)
      values (${tenantId}, ${subjectId}, ${version})`;
  }

  it('holds one row per subject and version', async () => {
    await accept('1');
    await accept('2');
    await expect(accept('1')).rejects.toMatchObject({
      constraint_name: 'subject_terms_acceptances_pkey',
    });
  });

  it('refuses a subject the tenant does not have', async () => {
    await expect(
      handle().sql`insert into subject_terms_acceptances (tenant_id, subject_id, version)
        values (${otherTenantId}, ${subjectId}, '1')`,
    ).rejects.toMatchObject({ constraint_name: 'subject_terms_acceptances_subject_fk' });
  });

  it('is deleted with the subject', async () => {
    await handle().sql`delete from subjects where id = ${subjectId}`;
    const rows = await handle().sql`select 1 from subject_terms_acceptances`;
    expect(rows).toHaveLength(0);
  });

  it('is isolated by tenant: a context for another tenant sees none of its rows', async () => {
    const [fresh] = await handle().sql<{ id: string }[]>`
      insert into subjects (id, tenant_id, type) values (gen_random_uuid(), ${tenantId}, 'user')
      returning id`;
    await handle().sql`insert into subject_terms_acceptances (tenant_id, subject_id, version)
      values (${tenantId}, ${fresh?.id ?? ''}, '1')`;
    if (container === undefined) throw new Error('database not started');
    appDb = createDatabase(await createAppRole(container.adminUrl), { max: 2 });
    const own = await withTenant(appDb.db, tenantId, (tx) =>
      tx.execute(sql`select 1 from subject_terms_acceptances`),
    );
    const foreign = await withTenant(appDb.db, otherTenantId, (tx) =>
      tx.execute(sql`select 1 from subject_terms_acceptances`),
    );
    expect(own).toHaveLength(1);
    expect(foreign).toHaveLength(0);
  });

  it('is added again to no effect when the migration file runs a second time', async () => {
    const file = readFileSync(join(MIGRATIONS_DIR, '0136_more_required_actions.sql'), 'utf8');
    await handle().sql.unsafe(file);
    await expect(accept('9')).rejects.toBeDefined();
  });
});
