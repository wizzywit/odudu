import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

const TAG = '0124_agent_write_budget';

let container: TestDatabase | undefined;
let admin: DatabaseHandle | undefined;
let owner: DatabaseHandle | undefined;
let before: string | undefined;

// A role that is neither SUPERUSER nor BYPASSRLS migrates, so the lift of forced
// row security the backfill needs is the branch that runs.
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

describe('the write budget migration', () => {
  it('names the root of every grant an exchange made, and forces row security again', async () => {
    if (owner === undefined || admin === undefined) throw new Error('not started');
    await admin.sql`insert into tenants (id, name) values (gen_random_uuid(), 'one')`;
    await admin.sql`insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), id, 'user' from tenants`;
    await admin.sql`insert into clients (id, tenant_id, client_id, name, type)
      select gen_random_uuid(), id, 'agent', 'Agent', 'public' from tenants`;
    const sql = admin.sql;
    const grant = (name: string, parent: string | null) => sql<{ id: string }[]>`
      insert into token_grants (id, tenant_id, client_id, subject_id, scope, exchanged_from_grant_id)
      select gen_random_uuid(), c.tenant_id, c.id, s.id, ${name},
             (select id from token_grants where scope = ${parent})
        from clients c join subjects s on s.tenant_id = c.tenant_id where c.client_id = 'agent'
      returning id`;
    await grant('root', null);
    await grant('child', 'root');
    await grant('grandchild', 'child');
    await grant('other', null);

    await runMigrations(owner.db, MIGRATIONS_DIR);

    const rows = await admin.sql<{ scope: string; root_scope: string | null }[]>`
      select g.scope, r.scope as root_scope
        from token_grants g left join token_grants r on r.id = g.budget_grant_id order by g.scope`;
    expect(rows).toEqual([
      { scope: 'child', root_scope: 'root' },
      { scope: 'grandchild', root_scope: 'root' },
      { scope: 'other', root_scope: null },
      { scope: 'root', root_scope: null },
    ]);
    const notForced = await admin.sql<{ relname: string }[]>`
      select relname from pg_class where relname = 'token_grants' and not relforcerowsecurity`;
    expect(notForced).toEqual([]);
  });
});
