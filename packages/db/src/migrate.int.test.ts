import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client.js';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate.js';
import { realms } from '#/schema/index.js';

// Guarded (possibly-undefined) handles for cleanup: beforeAll can throw
// before assignment (Docker down, image pull failure), and afterAll must
// still run without a TypeError obscuring the real cause.
let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;

// Non-optional bindings for the test bodies below, which only ever run
// after beforeAll has succeeded.
let container: TestDatabase;
let handle: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  dbHandle = createDatabase(container.adminUrl);
  handle = dbHandle;
  await runMigrations(handle.db, MIGRATIONS_DIR);
});

afterAll(async () => {
  await dbHandle?.close();
  await containerHandle?.stop();
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
    await expect(
      handle.db.insert(realms).values({ id: newId(), name: 'acme' }),
    ).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint_name: 'realms_name_unique',
      },
    });
  });

  it('is idempotent when run a second time', async () => {
    await expect(runMigrations(handle.db, MIGRATIONS_DIR)).resolves.toBeUndefined();
  });
});
