import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { expectedOutcomes, outcomes, seed } from '#/testing/service-accounts-seed';

const TAG = '0122_service_accounts_by_grant';

let container: TestDatabase | undefined;
let admin: DatabaseHandle | undefined;
let owner: DatabaseHandle | undefined;
let before: string | undefined;

// A migration role that is neither SUPERUSER nor BYPASSRLS, so every table it
// creates is subject to the policies FORCE ROW LEVEL SECURITY puts on its own
// owner: the strictest role the migration can meet.
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

describe('the service-account migration under an owner row security applies to', () => {
  it('is run by a role with neither SUPERUSER nor BYPASSRLS, which sees no row of a forced table', async () => {
    if (owner === undefined || admin === undefined) throw new Error('not started');
    const role = await owner.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await seed(admin.sql);
    const seen = await owner.sql<{ n: number }[]>`select count(*)::int as n from clients`;
    expect(seen[0]?.n).toBe(0);
  });

  it('retires what nothing names and keeps what something does', async () => {
    if (owner === undefined || admin === undefined) throw new Error('not started');
    await runMigrations(owner.db, MIGRATIONS_DIR);
    expect(await outcomes(admin.sql)).toEqual(expectedOutcomes());
    const forced = await admin.sql<{ relname: string }[]>`
      select relname from pg_class
       where relname in ('clients', 'client_oidc_config', 'subjects', 'token_grants')
         and not relforcerowsecurity`;
    expect(forced).toEqual([]);
  });
});
