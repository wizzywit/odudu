import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

const TAG = '0106_clients_skip_logout_confirmation';

let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;
let before: string | undefined;

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

describe('clients.skip_logout_confirmation', () => {
  it('the console client has it on after migration, every other client off', async () => {
    const handle = dbHandle;
    if (handle === undefined) throw new Error('database not started');
    await handle.sql`insert into tenants (id, name) values (gen_random_uuid(), 'existing')`;
    await handle.sql`
      insert into clients (id, tenant_id, client_id, name, type, builtin_admin)
      select gen_random_uuid(), id, 'odudu-admin', 'Odudu administration', 'public', true
      from tenants where name = 'existing'`;
    await handle.sql`
      insert into clients (id, tenant_id, client_id, name, type)
      select gen_random_uuid(), id, 'app', 'An application', 'public'
      from tenants where name = 'existing'`;

    await runMigrations(handle.db, MIGRATIONS_DIR);

    const rows = await handle.sql<{ client_id: string; skip: boolean }[]>`
      select client_id, skip_logout_confirmation as skip from clients
      where tenant_id = (select id from tenants where name = 'existing')`;
    const skips = Object.fromEntries(rows.map((row) => [row.client_id, row.skip]));
    expect(skips).toEqual({ 'odudu-admin': true, app: false });
  });

  it('is off for a client inserted without naming it', async () => {
    const handle = dbHandle;
    if (handle === undefined) throw new Error('database not started');
    await handle.sql`insert into tenants (id, name) values (gen_random_uuid(), 'later')`;
    await handle.sql`
      insert into clients (id, tenant_id, client_id, name, type)
      select gen_random_uuid(), id, 'later-app', 'Later', 'public'
      from tenants where name = 'later'`;

    const rows = await handle.sql<{ skip: boolean }[]>`
      select skip_logout_confirmation as skip from clients where client_id = 'later-app'`;
    expect(rows.map((row) => row.skip)).toEqual([false]);
  });
});
