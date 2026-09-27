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

// The driver reports a constraint violation on the postgres.js error, not
// on the Drizzle wrapper's own message — see roles.int.test.ts's
// causeMessage (packages/domain-authz/tests) for the same idiom.
async function causeMessage(promise: Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await promise;
    expect.unreachable('expected the insert to be rejected');
  } catch (error) {
    caught = error;
  }
  const cause = (caught as Error).cause;
  expect(cause).toBeInstanceOf(Error);
  return (cause as Error).message;
}

describe('the tenants_name_dns_label CHECK', () => {
  it.each(CORPUS.accepted)('accepts %j, agreeing with isValidTenantName', async (name) => {
    expect(isValidTenantName(name)).toBe(true);
    await expect(insert(name)).resolves.toBeDefined();
  });

  it.each(CORPUS.refused)('refuses %j, agreeing with isValidTenantName', async (name) => {
    expect(isValidTenantName(name)).toBe(false);
    expect(await causeMessage(insert(name))).toContain('tenants_name_dns_label');
  });
});
