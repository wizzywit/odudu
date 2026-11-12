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
  await db.sql`insert into tenants (id, name) values (gen_random_uuid(), 'ret')`;
  await db.sql`insert into subjects (id, tenant_id, type)
    select gen_random_uuid(), id, 'user' from tenants`;
}, 180_000);

afterAll(async () => {
  await db?.close();
  await container?.stop();
});

async function insertToken(client: string | null, uri: string | null): Promise<void> {
  await handle().sql`insert into action_tokens
      (id, tenant_id, subject_id, type, token_hash, expires_at, client_id, return_uri)
    select gen_random_uuid(), t.id, s.id, 'verify_email', md5(random()::text),
      now() + interval '1 hour', ${client}::uuid, ${uri}
      from tenants t join subjects s on s.tenant_id = t.id`;
}

describe('action_tokens.client_id and return_uri', () => {
  it('are both null on a link that names no client', async () => {
    await insertToken(null, null);
    const rows = await handle().sql<{ client_id: string | null; return_uri: string | null }[]>`
      select client_id, return_uri from action_tokens`;
    expect(rows).toEqual([{ client_id: null, return_uri: null }]);
  });

  it('are held together: either alone is refused', async () => {
    await expect(insertToken('7f6d2f0e-4f55-4c0e-9e2d-0f6f3a1e8b11', null)).rejects.toMatchObject({
      constraint_name: 'action_tokens_return_check',
    });
    await expect(insertToken(null, 'https://a.example/cb')).rejects.toMatchObject({
      constraint_name: 'action_tokens_return_check',
    });
    await insertToken('7f6d2f0e-4f55-4c0e-9e2d-0f6f3a1e8b11', 'https://a.example/cb');
  });

  it('is added again to no effect when the migration file runs a second time', async () => {
    const file = readFileSync(join(MIGRATIONS_DIR, '0129_action_token_return.sql'), 'utf8');
    await handle().sql.unsafe(file);
    await expect(insertToken(null, 'https://a.example/cb')).rejects.toBeDefined();
  });
});
