import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';

let container: TestDatabase | undefined;
let handle: DatabaseHandle | undefined;

beforeAll(async () => {
  container = await startTestDatabase();
  handle = createDatabase(container.adminUrl);
});

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

it('types a parameter from its JavaScript value, so a polymorphic call resolves', async () => {
  if (handle === undefined) throw new Error('the database did not start');
  const rows = await handle.db.execute(
    sql`select jsonb_set('{}'::jsonb, '{on}', to_jsonb(${true})) as flag, to_jsonb(${false}) as bare`,
  );
  expect(rows[0]).toEqual({ flag: { on: true }, bare: false });
});
