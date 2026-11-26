import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import {
  ASSISTANT_CLIENT_ID,
  clientRepository,
  provisionAssistantClient,
  provisionTenantDefaults,
} from '@odudu/domain-tenant';
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
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
    await provisionTenantDefaults(tx, tenantId);
  });
  return tenantId;
}

describe('provisionAssistantClient', () => {
  it('creates the built-in public client, marked, with no secret', async () => {
    const tenantId = await freshTenant();
    const client = await withTenant(app.db, tenantId, (tx) =>
      provisionAssistantClient(tx, tenantId),
    );
    expect(client).toMatchObject({
      clientId: ASSISTANT_CLIENT_ID,
      tenantId,
      type: 'public',
      secretHash: null,
      enabled: true,
      builtinAssistant: true,
      builtinAdmin: false,
      builtinMcp: false,
    });
  });

  it('finds the client it made and writes nothing the second time', async () => {
    const tenantId = await freshTenant();
    const first = await withTenant(app.db, tenantId, (tx) =>
      provisionAssistantClient(tx, tenantId),
    );
    const second = await withTenant(app.db, tenantId, (tx) =>
      provisionAssistantClient(tx, tenantId),
    );
    expect(second.id).toBe(first.id);
  });

  it('refuses a client that carries the id without being the built-in one', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, (tx) =>
      clientRepository(tx).create({
        tenantId,
        clientId: ASSISTANT_CLIENT_ID,
        name: 'Mine',
        type: 'public',
        secretHash: null,
      }),
    );
    await expect(
      withTenant(app.db, tenantId, (tx) => provisionAssistantClient(tx, tenantId)),
    ).rejects.toMatchObject({ code: 'assistant_client_not_builtin' });
  });
});
