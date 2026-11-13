import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

let container: TestDatabase | undefined;
let db: DatabaseHandle | undefined;

function handle(): DatabaseHandle {
  if (db === undefined) throw new Error('database not started');
  return db;
}

beforeAll(async () => {
  container = await startTestDatabase();
  db = createDatabase(container.adminUrl);
  await runMigrations(db.db, MIGRATIONS_DIR);
  await db.sql`insert into tenants (id, name) values (gen_random_uuid(), 'acts')`;
  await db.sql`insert into clients (id, tenant_id, client_id, name, type)
    select gen_random_uuid(), id, 'pub', 'Pub', 'public' from tenants`;
  await db.sql`insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method)
    select c.id, c.tenant_id, ARRAY['https://a.example/cb'], ARRAY['authorization_code'], 'none'
      from clients c`;
}, 180_000);

afterAll(async () => {
  await db?.close();
  await container?.stop();
});

async function setActions(actions: string[]): Promise<void> {
  await handle().sql`update client_oidc_config set allowed_actions = ${actions}::text[]`;
}

describe('client_oidc_config.allowed_actions', () => {
  it('starts empty on a row written without it', async () => {
    const rows = await handle().sql<{ allowed_actions: string[] }[]>`
      select allowed_actions from client_oidc_config`;
    expect(rows).toEqual([{ allowed_actions: [] }]);
  });

  it('takes any of the four required actions, together or alone', async () => {
    await setActions(['update-password', 'configure-totp', 'configure-passkey']);
    await setActions(['generate-recovery-codes']);
    await setActions([]);
  });

  it('refuses a name outside the vocabulary, alone or among valid ones', async () => {
    await expect(setActions(['delete-account'])).rejects.toMatchObject({
      constraint_name: 'client_oidc_config_allowed_actions_check',
    });
    await expect(setActions(['update-password', 'Configure-TOTP'])).rejects.toMatchObject({
      constraint_name: 'client_oidc_config_allowed_actions_check',
    });
  });

  it('is added again to no effect when the migration file runs a second time', async () => {
    const file = readFileSync(join(MIGRATIONS_DIR, '0128_client_allowed_actions.sql'), 'utf8');
    await handle().sql.unsafe(file);
    await expect(setActions(['nonsense'])).rejects.toBeDefined();
  });
});
