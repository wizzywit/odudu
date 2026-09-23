import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function insertSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into subjects (id, tenant_id, type) values (${id}, ${tenantId}, 'user')
  `);
  return id;
}

async function insertClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientKey: string,
): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into clients (id, tenant_id, client_id, name, type, secret_hash)
    values (${id}, ${tenantId}, ${clientKey}, 'A client', 'public', null)
  `);
  return id;
}

// Bypasses roleRepository.addComposite, which refuses a cycle by walking
// the closure before inserting — this writes the edge a future writer
// might still produce despite that guard, to prove effectiveRoles survives
// data it cannot itself prevent.
async function rawInsertComposite(
  tx: TenantScopedDatabase,
  tenantId: string,
  parentRoleId: string,
  childRoleId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into role_composites (tenant_id, parent_role_id, child_role_id)
    values (${tenantId}, ${parentRoleId}, ${childRoleId})
  `);
}

interface TestSubject {
  tenantId: string;
  subjectId: string;
  createRole: (name: string, clientId?: string | null) => Promise<RoleRecord>;
  addComposite: (parentRoleId: string, childRoleId: string) => Promise<void>;
  rawInsertComposite: (parentRoleId: string, childRoleId: string) => Promise<void>;
  assignToSubject: (roleId: string) => Promise<void>;
  insertClient: (clientKey: string) => Promise<string>;
  names: () => Promise<string[]>;
}

async function testSubject(): Promise<TestSubject> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  const subjectId = await withTenant(app.db, tenantId, (tx) => insertSubject(tx, tenantId));

  return {
    tenantId,
    subjectId,
    createRole: (name, clientId = null) =>
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).create({ tenantId, name, clientId })),
    addComposite: (parentRoleId, childRoleId) =>
      withTenant(app.db, tenantId, (tx) =>
        roleRepository(tx).addComposite(parentRoleId, childRoleId),
      ),
    rawInsertComposite: (parentRoleId, childRoleId) =>
      withTenant(app.db, tenantId, (tx) =>
        rawInsertComposite(tx, tenantId, parentRoleId, childRoleId),
      ),
    assignToSubject: (roleId) =>
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).assignToSubject(subjectId, roleId)),
    insertClient: (clientKey) =>
      withTenant(app.db, tenantId, (tx) => insertClient(tx, tenantId, clientKey)),
    names: async () => {
      const found = await withTenant(app.db, tenantId, (tx) => effectiveRoles(tx, subjectId));
      return found.map((role) => role.name);
    },
  };
}

describe('effectiveRoles', () => {
  it('returns a directly assigned tenant role', async () => {
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

    const found = await withTenant(app.db, subject.tenantId, (tx) =>
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

  it('returns nothing for a subject in another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subjectId = await insertSubject(tx, tenantId);
        const admin = await roleRepository(tx).create({ tenantId, name: 'admin' });
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
