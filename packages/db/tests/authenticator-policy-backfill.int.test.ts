import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

const TAG = '0132_authenticator_policy';

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

describe('the authenticator policy migration', () => {
  it('records the parameters every earlier enrolment was made under, and keeps those already recorded', async () => {
    if (owner === undefined || admin === undefined) throw new Error('not started');
    await admin.sql`insert into tenants (id, name) values (gen_random_uuid(), 'one')`;
    await admin.sql`insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), id, 'user' from tenants`;
    const sql = admin.sql;
    const credential = (type: string, label: string, data: object) => sql`
      insert into user_credentials (id, tenant_id, subject_id, type, secret_data, label)
      select gen_random_uuid(), tenant_id, id, ${type}, ${JSON.stringify(data)}::jsonb, ${label}
        from subjects`;
    await credential('totp', 'old-totp', { secret: 'AAAA', digits: 6, lastStep: 4 });
    await credential('webauthn', 'old-key', { publicKey: 'pk', counter: 1, transports: [] });
    await credential('password', 'pw', { hash: 'h' });
    await credential('webauthn', 'kept-key', {
      publicKey: 'pk',
      counter: 1,
      transports: [],
      userVerification: 'preferred',
      residentKey: 'discouraged',
    });

    await runMigrations(owner.db, MIGRATIONS_DIR);
    await runMigrations(owner.db, MIGRATIONS_DIR);

    const rows = await admin.sql<{ label: string; secret_data: Record<string, unknown> }[]>`
      select label, secret_data from user_credentials order by label`;
    expect(Object.fromEntries(rows.map((row) => [row.label, row.secret_data]))).toEqual({
      'kept-key': {
        publicKey: 'pk',
        counter: 1,
        transports: [],
        userVerification: 'preferred',
        residentKey: 'discouraged',
      },
      'old-key': {
        publicKey: 'pk',
        counter: 1,
        transports: [],
        userVerification: 'required',
        residentKey: 'required',
      },
      'old-totp': { secret: 'AAAA', digits: 6, lastStep: 4, algorithm: 'SHA1', period: 30 },
      pw: { hash: 'h' },
    });
    const notForced = await admin.sql<{ relname: string }[]>`
      select relname from pg_class where relname = 'user_credentials' and not relforcerowsecurity`;
    expect(notForced).toEqual([]);
  });

  it('gives a tenant the defaults every enrolment was made with', async () => {
    if (admin === undefined) throw new Error('not started');
    const rows = await admin.sql<Record<string, unknown>[]>`
      select totp_algorithm, totp_digits, totp_period, webauthn_user_verification,
             webauthn_resident_key, recovery_code_count from tenants`;
    expect(rows[0]).toEqual({
      totp_algorithm: 'SHA1',
      totp_digits: 6,
      totp_period: 30,
      webauthn_user_verification: 'required',
      webauthn_resident_key: 'required',
      recovery_code_count: 10,
    });
  });
});
