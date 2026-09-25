import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

// The driver reports a constraint violation on the postgres.js error, not on
// the Drizzle wrapper's own message — the idiom clients.int.test.ts and
// roles.int.test.ts both use for the same reason.
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

describe('the system tenant', () => {
  it('refuses a second built-in admin client in one tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
      await tx.insert(clients).values({
        id: newId(),
        tenantId,
        clientId: 'odudu-admin',
        name: 'Admin',
        type: 'confidential',
        secretHash: 'hashed:secret',
        builtinAdmin: true,
      });
    });
    expect(
      await causeMessage(
        withTenant(app.db, tenantId, async (tx) => {
          await tx.insert(clients).values({
            id: newId(),
            tenantId,
            clientId: 'odudu-admin-2',
            name: 'Admin 2',
            type: 'confidential',
            secretHash: 'hashed:secret',
            builtinAdmin: true,
          });
        }),
      ),
    ).toContain('clients_one_builtin_admin');
  });
});
