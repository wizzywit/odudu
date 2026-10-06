import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';

let container: TestDatabase | undefined;
let handle: DatabaseHandle | undefined;

beforeAll(async () => {
  container = await startTestDatabase();
  handle = createDatabase(container.adminUrl);
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

describe('createDatabase', () => {
  it('opens every connection with JIT compilation off', async () => {
    if (handle === undefined) throw new Error('beforeAll did not run');
    const rows = await handle.sql<{ jit: string }[]>`select current_setting('jit') as jit`;
    expect(rows[0]?.jit).toBe('off');
  });
});
