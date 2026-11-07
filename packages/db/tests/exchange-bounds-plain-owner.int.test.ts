import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

const TAG = '0119_clients_approved_at';
const EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

let container: TestDatabase | undefined;
let admin: DatabaseHandle | undefined;
let owner: DatabaseHandle | undefined;
let before: string | undefined;

// Both files read and write tables that force row security. For a migrating
// role that is neither SUPERUSER nor BYPASSRLS they lift it for the statement
// and put it back, as the files after them do; run as the container's
// superuser the other backfill tests never take that branch.
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

describe('the client approval and exchange-bound migrations under an owner row security applies to', () => {
  it('backfill approved_at and is_public_client, and force row security again', async () => {
    if (owner === undefined || admin === undefined) throw new Error('not started');
    const role = await owner.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await admin.sql`insert into tenants (id, name) values (gen_random_uuid(), 'one')`;
    await admin.sql`insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), id, 'user' from tenants`;
    await admin.sql`insert into clients (id, tenant_id, client_id, name, type)
      select gen_random_uuid(), id, 'pub', 'Pub', 'public' from tenants`;
    await admin.sql`insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method)
      select c.id, c.tenant_id, ARRAY['https://a.example/cb'], ARRAY[${EXCHANGE}]::text[], 'none'
        from clients c where c.client_id = 'pub'`;
    await admin.sql`insert into consents (id, tenant_id, subject_id, client_id)
      select gen_random_uuid(), c.tenant_id, s.id, c.id
        from clients c join subjects s on s.tenant_id = c.tenant_id where c.client_id = 'pub'`;

    await runMigrations(owner.db, MIGRATIONS_DIR);

    const rows = await admin.sql<{ approved: boolean; is_public: boolean }[]>`
      select c.approved_at is not null as approved, o.is_public_client as is_public
        from clients c join client_oidc_config o on o.client_id = c.id where c.client_id = 'pub'`;
    expect(rows).toEqual([{ approved: true, is_public: true }]);
    const notForced = await admin.sql<{ relname: string }[]>`
      select relname from pg_class
       where relname in ('clients', 'client_oidc_config', 'consents') and not relforcerowsecurity`;
    expect(notForced).toEqual([]);
  });
});
