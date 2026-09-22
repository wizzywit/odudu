import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { clientScopeRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reachableRoleIds } from '#/repository/scope-role-reach';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

describe('reachableRoleIds', () => {
  it('finds the role a granted scope reaches in the same tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const scope = await clientScopeRepository(tx).create({ tenantId, name: 'reports:read' });
      const role = await roleRepository(tx).create({ tenantId, name: 'reports-reader' });
      await roleRepository(tx).mapToClientScope(scope.id, role.id);

      const found = await reachableRoleIds(tx, ['reports:read']);
      expect(found).toEqual(new Set([role.id]));
    });
  });

  it('reaches nothing for a scope name the tenant never defined', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const found = await reachableRoleIds(tx, ['no-such-scope']);
      expect(found).toEqual(new Set());
    });
  });

  // Not `expectCrossTenantMethodProbe`: that helper never gives tenant B a
  // `tenants` row of its own (every existing probe only reads under tenant
  // B, never inserts), and this test needs tenant B to hold a same-named
  // `client_scopes` row so an empty result can only come from RLS hiding
  // tenant A's `client_scope_roles` mapping — not from 'reports:read'
  // simply not existing in tenant B.
  it('does not find another tenant’s scope-to-role mapping', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const roleAId = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const scope = await clientScopeRepository(tx).create({
        tenantId: tenantA,
        name: 'reports:read',
      });
      const role = await roleRepository(tx).create({ tenantId: tenantA, name: 'reports-reader' });
      await roleRepository(tx).mapToClientScope(scope.id, role.id);
      return role.id;
    });

    await withTenant(app.db, tenantA, async (tx) => {
      const found = await reachableRoleIds(tx, ['reports:read']);
      expect(found).toEqual(new Set([roleAId]));
    });

    await withTenant(app.db, tenantB, async (tx) => {
      await seedTenant(tx, tenantB);
      await clientScopeRepository(tx).create({ tenantId: tenantB, name: 'reports:read' });

      const found = await reachableRoleIds(tx, ['reports:read']);
      expect(found).toEqual(new Set());
    });
  });
});
