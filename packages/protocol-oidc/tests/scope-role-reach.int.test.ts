import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { roleRepository } from '@odudu/domain-authz';
import { clientScopeRepository } from '@odudu/domain-realm';
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

  it('does not find another realm’s scope-to-role mapping', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const scope = await clientScopeRepository(tx).create({ realmId, name: 'reports:read' });
        const role = await roleRepository(tx).create({ realmId, name: 'reports-reader' });
        await roleRepository(tx).mapToClientScope(scope.id, role.id);
        return { roleId: role.id };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await reachableRoleIds(tx, ['reports:read']);
        expect(found).toEqual(new Set([seeded.roleId]));
      },
      // A foreign realm has no client_scopes row named 'reports:read' of
      // its own, so this is the same "missing means absent" path a
      // same-realm unknown scope name takes above — not a leak to prove
      // separately from it.
      attempt: async (tx) => reachableRoleIds(tx, ['reports:read']),
      expectBlocked: (result) => {
        expect(result).toEqual(new Set());
      },
    });
  });
});
