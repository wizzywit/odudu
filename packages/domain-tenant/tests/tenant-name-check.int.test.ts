import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isValidTenantName } from '#/service/tenant-name';
import { CORPUS } from '#/service/tenant-name.test';

let container: TestDatabase;
let owner: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await owner.close();
  await container.stop();
});

function insert(name: string): Promise<unknown> {
  const id = newId();
  return withTenant(owner.db, id, (tx) => tx.insert(tenants).values({ id, name }));
}

describe('the tenants_name_dns_label CHECK', () => {
  it.each(CORPUS.accepted)('accepts %j, agreeing with isValidTenantName', async (name) => {
    expect(isValidTenantName(name)).toBe(true);
    await expect(insert(name)).resolves.toBeDefined();
  });

  it.each(CORPUS.refused)('refuses %j, agreeing with isValidTenantName', async (name) => {
    expect(isValidTenantName(name)).toBe(false);
    await expect(insert(name)).rejects.toThrow();
  });
});
