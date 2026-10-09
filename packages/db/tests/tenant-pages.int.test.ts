import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { tenants } from '#/schema/index';
import { tenantIdPages } from '#/tenant-pages';

let container: TestDatabase | undefined;
let owner: DatabaseHandle | undefined;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  await owner.db
    .insert(tenants)
    .values(Array.from({ length: 7 }, (_, n) => ({ id: newId(), name: `paged-${String(n)}` })));
}, 120_000);

afterAll(async () => {
  await owner?.close();
  await container?.stop();
});

describe('tenantIdPages', () => {
  it('walks every tenant once, in key order, a page at a time', async () => {
    if (owner === undefined) throw new Error('beforeAll did not run');
    const pages: string[][] = [];
    for await (const page of tenantIdPages(owner.db, 3)) pages.push([...page]);

    expect(pages.map((page) => page.length)).toEqual([3, 3, 1]);
    const seen = pages.flat();
    expect(seen).toEqual([...seen].sort());
    expect(new Set(seen).size).toBe(7);
  });

  it('yields one page where the size exceeds the tenants', async () => {
    if (owner === undefined) throw new Error('beforeAll did not run');
    const pages: string[][] = [];
    for await (const page of tenantIdPages(owner.db, 1000)) pages.push([...page]);

    expect(pages.map((page) => page.length)).toEqual([7]);
  });
});
