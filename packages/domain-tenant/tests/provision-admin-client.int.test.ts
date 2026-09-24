import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  provisionAdminClient,
  TENANT_ADMIN,
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
  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });
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
  });
  return tenantId;
}

describe('provisionAdminClient', () => {
  it('creates the client and the seven capability roles', async () => {
    const tenantId = await freshTenant();
    const { clientDbId } = await withTenant(app.db, tenantId, (tx) =>
      provisionAdminClient(tx, tenantId),
    );
    await withTenant(app.db, tenantId, async (tx) => {
      const repo = roleRepository(tx);
      for (const name of [
        'view-users',
        'manage-users',
        'manage-clients',
        'manage-tenant',
        'manage-keys',
        'manage-sessions',
        'view-audit',
      ]) {
        expect(await repo.byName(name, clientDbId), name).not.toBeNull();
      }
      expect(await repo.byName(TENANT_ADMIN, clientDbId)).not.toBeNull();
      expect(await repo.byName('manage-tenants', clientDbId)).toBeNull();
    });
  });

  it('provisions manage-tenants only when asked, and only once', async () => {
    const tenantId = await freshTenant();
    const { clientDbId } = await withTenant(app.db, tenantId, (tx) =>
      provisionAdminClient(tx, tenantId, { crossTenant: true }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      provisionAdminClient(tx, tenantId, { crossTenant: true }),
    );
    await withTenant(app.db, tenantId, async (tx) => {
      expect(await roleRepository(tx).byName('manage-tenants', clientDbId)).not.toBeNull();
    });
  });

  it('is invisible from another tenant', async () => {
    const mine = await freshTenant();
    const theirs = await freshTenant();
    await withTenant(app.db, mine, (tx) => provisionAdminClient(tx, mine));
    await withTenant(app.db, theirs, async (tx) => {
      expect(await clientRepository(tx).byClientId(ADMIN_CLIENT_ID)).toBeNull();
    });
  });
});
