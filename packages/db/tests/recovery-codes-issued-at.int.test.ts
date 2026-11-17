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
}, 180_000);

afterAll(async () => {
  await db?.close();
  await container?.stop();
});

describe('subjects.recovery_codes_issued_at', () => {
  it('is a nullable timestamp with a time zone, null on a subject with no set', async () => {
    await handle().sql`insert into tenants (id, name) values (gen_random_uuid(), 'rc')`;
    await handle().sql`insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), id, 'user' from tenants`;
    const rows = await handle().sql<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable from information_schema.columns
       where table_name = 'subjects' and column_name = 'recovery_codes_issued_at'`;
    expect(rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);
    const subjects = await handle().sql<{ at: Date | null }[]>`
      select recovery_codes_issued_at as at from subjects`;
    expect(subjects).toEqual([{ at: null }]);
  });

  it('is added again to no effect when the migration file runs a second time', async () => {
    const file = readFileSync(join(MIGRATIONS_DIR, '0130_recovery_codes_issued_at.sql'), 'utf8');
    await handle().sql.unsafe(file);
    const subjects = await handle().sql<{ at: Date | null }[]>`
      select recovery_codes_issued_at as at from subjects`;
    expect(subjects).toEqual([{ at: null }]);
  });
});
