import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client.js';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate.js';
import { realms } from '#/schema/index.js';

let container: TestDatabase;
let handle: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  handle = createDatabase(container.adminUrl);
  await runMigrations(handle.db, MIGRATIONS_DIR);
});

afterAll(async () => {
  await handle.close();
  await container.stop();
});

describe('migrations', () => {
  it('creates the realms table with the expected columns', async () => {
    const rows = await handle.sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'realms'
      order by column_name
    `;

    expect(rows.map((row) => row.column_name)).toEqual([
      'created_at',
      'display_name',
      'enabled',
      'id',
      'name',
    ]);
  });

  it('round-trips a realm', async () => {
    await handle.db.insert(realms).values({ id: newId(), name: 'acme' });

    const found = await handle.db.select().from(realms);

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('acme');
    expect(found[0]?.enabled).toBe(true);
  });

  it('rejects a duplicate realm name', async () => {
    await expect(handle.db.insert(realms).values({ id: newId(), name: 'acme' })).rejects.toThrow();
  });

  it('is idempotent when run a second time', async () => {
    await expect(runMigrations(handle.db, MIGRATIONS_DIR)).resolves.toBeUndefined();
  });
});
