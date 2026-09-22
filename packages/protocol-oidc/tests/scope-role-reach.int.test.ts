import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
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

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

describe('reachableRoleIds', () => {
  it('finds the role a granted scope reaches in the same realm', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const scope = await clientScopeRepository(tx).create({ realmId, name: 'reports:read' });
      const role = await roleRepository(tx).create({ realmId, name: 'reports-reader' });
      await roleRepository(tx).mapToClientScope(scope.id, role.id);

      const found = await reachableRoleIds(tx, ['reports:read']);
      expect(found).toEqual(new Set([role.id]));
    });
  });

  it('reaches nothing for a scope name the realm never defined', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const found = await reachableRoleIds(tx, ['no-such-scope']);
      expect(found).toEqual(new Set());
    });
  });

  // Not `expectCrossRealmMethodProbe`: that helper never gives realm B a
  // `realms` row of its own (every existing probe only reads under realm
  // B, never inserts), and this test needs realm B to hold a same-named
  // `client_scopes` row so an empty result can only come from RLS hiding
  // realm A's `client_scope_roles` mapping — not from 'reports:read'
  // simply not existing in realm B.
  it('does not find another realm’s scope-to-role mapping', async () => {
    const realmA = newId();
    const realmB = newId();

    const roleAId = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      const scope = await clientScopeRepository(tx).create({
        realmId: realmA,
        name: 'reports:read',
      });
      const role = await roleRepository(tx).create({ realmId: realmA, name: 'reports-reader' });
      await roleRepository(tx).mapToClientScope(scope.id, role.id);
      return role.id;
    });

    await withRealm(app.db, realmA, async (tx) => {
      const found = await reachableRoleIds(tx, ['reports:read']);
      expect(found).toEqual(new Set([roleAId]));
    });

    await withRealm(app.db, realmB, async (tx) => {
      await seedRealm(tx, realmB);
      await clientScopeRepository(tx).create({ realmId: realmB, name: 'reports:read' });

      const found = await reachableRoleIds(tx, ['reports:read']);
      expect(found).toEqual(new Set());
    });
  });
});
