import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { expectedOutcomes, outcomes, seed } from './service-accounts-seed.js';

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

describe('the service-account migration', () => {
  it('deletes the accounts nothing names, keeps the rest and marks them, and runs again to no effect', async () => {
    await seed(handle().sql);
    await runMigrations(handle().db, MIGRATIONS_DIR);
    const once = await outcomes(handle().sql);
    expect(once).toEqual(expectedOutcomes());

    await handle().sql`delete from drizzle.__drizzle_migrations where created_at = (
      select max(created_at) from drizzle.__drizzle_migrations)`;
    await runMigrations(handle().db, MIGRATIONS_DIR);
    expect(await outcomes(handle().sql)).toEqual(once);
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
