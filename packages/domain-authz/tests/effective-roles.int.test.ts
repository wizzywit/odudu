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
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectiveRoles } from '#/repository/effective-roles';
import { roleRepository, type RoleRecord } from '#/repository/roles';

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

async function insertSubject(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into subjects (id, realm_id, type) values (${id}, ${realmId}, 'user')
  `);
  return id;
}

async function insertClient(
  tx: RealmScopedDatabase,
  realmId: string,
  clientKey: string,
): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into clients (id, realm_id, client_id, name, type, secret_hash)
    values (${id}, ${realmId}, ${clientKey}, 'A client', 'public', null)
  `);
  return id;
}

// Bypasses roleRepository.addComposite, which refuses a cycle by walking
// the closure before inserting — this writes the edge a future writer
// might still produce despite that guard, to prove effectiveRoles survives
// data it cannot itself prevent.
async function rawInsertComposite(
  tx: RealmScopedDatabase,
  realmId: string,
  parentRoleId: string,
  childRoleId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into role_composites (realm_id, parent_role_id, child_role_id)
    values (${realmId}, ${parentRoleId}, ${childRoleId})
  `);
}

interface TestSubject {
  realmId: string;
  subjectId: string;
  createRole: (name: string, clientId?: string | null) => Promise<RoleRecord>;
  addComposite: (parentRoleId: string, childRoleId: string) => Promise<void>;
  rawInsertComposite: (parentRoleId: string, childRoleId: string) => Promise<void>;
  assignToSubject: (roleId: string) => Promise<void>;
  insertClient: (clientKey: string) => Promise<string>;
  names: () => Promise<string[]>;
}

async function testSubject(): Promise<TestSubject> {
  const realmId = newId();
  await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
  const subjectId = await withRealm(app.db, realmId, (tx) => insertSubject(tx, realmId));

  return {
    realmId,
    subjectId,
    createRole: (name, clientId = null) =>
      withRealm(app.db, realmId, (tx) => roleRepository(tx).create({ realmId, name, clientId })),
    addComposite: (parentRoleId, childRoleId) =>
      withRealm(app.db, realmId, (tx) =>
        roleRepository(tx).addComposite(parentRoleId, childRoleId),
      ),
    rawInsertComposite: (parentRoleId, childRoleId) =>
      withRealm(app.db, realmId, (tx) =>
        rawInsertComposite(tx, realmId, parentRoleId, childRoleId),
      ),
    assignToSubject: (roleId) =>
      withRealm(app.db, realmId, (tx) => roleRepository(tx).assignToSubject(subjectId, roleId)),
    insertClient: (clientKey) =>
      withRealm(app.db, realmId, (tx) => insertClient(tx, realmId, clientKey)),
    names: async () => {
      const found = await withRealm(app.db, realmId, (tx) => effectiveRoles(tx, subjectId));
      return found.map((role) => role.name);
    },
  };
}

describe('effectiveRoles', () => {
  it('returns a directly assigned realm role', async () => {
    const subject = await testSubject();
    const admin = await subject.createRole('admin');
    await subject.assignToSubject(admin.id);

    expect(await subject.names()).toEqual(['admin']);
  });

  it('follows a composite one level down', async () => {
    const subject = await testSubject();
    const admin = await subject.createRole('admin');
    const reader = await subject.createRole('reader');
    await subject.addComposite(admin.id, reader.id);
    await subject.assignToSubject(admin.id);

    expect(await subject.names()).toEqual(['admin', 'reader']);
  });

  it('follows a composite chain to its end', async () => {
    const subject = await testSubject();
    const a = await subject.createRole('a');
    const b = await subject.createRole('b');
    const c = await subject.createRole('c');
    await subject.addComposite(a.id, b.id);
    await subject.addComposite(b.id, c.id);
    await subject.assignToSubject(a.id);

    expect(await subject.names()).toEqual(['a', 'b', 'c']);
  });

  it('does not return a parent role when only a child was assigned', async () => {
    const subject = await testSubject();
    const admin = await subject.createRole('admin');
    const reader = await subject.createRole('reader');
    await subject.addComposite(admin.id, reader.id);
    await subject.assignToSubject(reader.id);

    expect(await subject.names()).toEqual(['reader']);
  });

  it('reports a client role with the owning client key, not its uuid', async () => {
    const subject = await testSubject();
    const clientId = await subject.insertClient('reports-api');
    const reader = await subject.createRole('reader', clientId);
    await subject.assignToSubject(reader.id);

    const found = await withRealm(app.db, subject.realmId, (tx) =>
      effectiveRoles(tx, subject.subjectId),
    );
    expect(found).toEqual([{ roleId: reader.id, name: 'reader', clientKey: 'reports-api' }]);
  });

  it('terminates on a cycle inserted behind the repository', async () => {
    const subject = await testSubject();
    const a = await subject.createRole('a');
    const b = await subject.createRole('b');
    await subject.rawInsertComposite(a.id, b.id);
    await subject.rawInsertComposite(b.id, a.id);
    await subject.assignToSubject(a.id);

    expect(await subject.names()).toEqual(['a', 'b']);
  }, 10_000);

  it('returns nothing for a subject in another realm', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subjectId = await insertSubject(tx, realmId);
        const admin = await roleRepository(tx).create({ realmId, name: 'admin' });
        await roleRepository(tx).assignToSubject(subjectId, admin.id);
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await effectiveRoles(tx, seeded.subjectId);
        expect(found.map((role) => role.name)).toContain('admin');
      },
      attempt: async (tx, seeded) => effectiveRoles(tx, seeded.subjectId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});
