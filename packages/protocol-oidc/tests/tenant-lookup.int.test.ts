import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantLookupRepository } from '#/repository/tenant-lookup';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('tenantLookupRepository.byName', () => {
  it('finds a tenant by its name and returns null for another', async () => {
    const repo = tenantLookupRepository(owner.db);
    const created = await repo.create({ id: newId(), name: 'lookup-acme' });
    expect((await repo.byName('lookup-acme'))?.id).toBe(created.id);
    expect(await repo.byName('lookup-other')).toBeNull();
  });

  it('returns null for a name holding U+0000 instead of a database error', async () => {
    const repo = tenantLookupRepository(owner.db);
    await repo.create({ id: newId(), name: 'lookup-nul' });
    expect(await repo.byName('lookup-nul\u0000')).toBeNull();
    expect(await repo.byName('\u0000')).toBeNull();
  });
});
