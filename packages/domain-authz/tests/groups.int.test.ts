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
import {
  descendantsOf,
  effectiveGroupPaths,
  groupRepository,
  type GroupRecord,
} from '#/repository/groups';
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

// The driver only carries the fired constraint's name on the query error's
// `.cause.message`, not on the top-level message `.rejects.toThrow` reads —
// see roles.int.test.ts's causeMessage for the same idiom.
async function causeMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    return (cause as Error).message;
  }
  expect.unreachable('expected the promise to reject');
}

// Each call gets its own freshly seeded tenant, the same convention
// roles.int.test.ts uses for `create` — so one test's group names can never
// collide with another's under `UNIQUE (tenant_id, path)`.
interface TenantFixture {
  tenantId: string;
  createGroup: (name: string, parentId: string | null) => Promise<GroupRecord>;
  reparent: (groupId: string, newParentId: string | null) => Promise<void>;
  byPath: (path: string) => Promise<GroupRecord | null>;
  createRole: (name: string) => Promise<RoleRecord>;
  mapRole: (groupId: string, roleId: string) => Promise<void>;
  insertSubject: () => Promise<string>;
  addToSubject: (subjectId: string, groupId: string) => Promise<void>;
  names: (subjectId: string) => Promise<string[]>;
  effectiveGroupPaths: (subjectId: string) => Promise<readonly string[]>;
}

async function tenantFixture(): Promise<TenantFixture> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));

  return {
    tenantId,
    createGroup: (name, parentId) =>
      withTenant(app.db, tenantId, (tx) =>
        groupRepository(tx).create({ tenantId, name, parentId }),
      ),
    reparent: (groupId, newParentId) =>
      withTenant(app.db, tenantId, (tx) => groupRepository(tx).reparent(groupId, newParentId)),
    byPath: (path) => withTenant(app.db, tenantId, (tx) => groupRepository(tx).byPath(path)),
    createRole: (name) =>
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).create({ tenantId, name })),
    mapRole: (groupId, roleId) =>
      withTenant(app.db, tenantId, (tx) => groupRepository(tx).mapRole(groupId, roleId)),
    insertSubject: () => withTenant(app.db, tenantId, (tx) => insertSubject(tx, tenantId)),
    addToSubject: (subjectId, groupId) =>
      withTenant(app.db, tenantId, (tx) => groupRepository(tx).addToSubject(subjectId, groupId)),
    names: async (subjectId) => {
      const found = await withTenant(app.db, tenantId, (tx) => effectiveRoles(tx, subjectId));
      return found.map((role) => role.name);
    },
    effectiveGroupPaths: (subjectId) =>
      withTenant(app.db, tenantId, (tx) => effectiveGroupPaths(tx, subjectId)),
  };
}

describe('paths', () => {
  it('gives a top-level group a single-segment absolute path', async () => {
    const tenant = await tenantFixture();
    const g = await tenant.createGroup('engineering', null);
    expect(g.path).toBe('/engineering');
  });

  it('builds a child path from its parent', async () => {
    const tenant = await tenantFixture();
    const parent = await tenant.createGroup('engineering', null);
    const child = await tenant.createGroup('platform', parent.id);
    expect(child.path).toBe('/engineering/platform');
  });

  it('permits the same name under two different parents', async () => {
    const tenant = await tenantFixture();
    const a = await tenant.createGroup('engineering', null);
    const b = await tenant.createGroup('sales', null);
    await expect(tenant.createGroup('platform', a.id)).resolves.toMatchObject({
      path: '/engineering/platform',
    });
    await expect(tenant.createGroup('platform', b.id)).resolves.toMatchObject({
      path: '/sales/platform',
    });
  });

  it('refuses a name containing the separator', async () => {
    const tenant = await tenantFixture();
    expect(await causeMessage(tenant.createGroup('a/b', null))).toContain(
      'groups_name_has_no_slash',
    );
  });

  it('refuses a group that would be its own ancestor', async () => {
    const tenant = await tenantFixture();
    const a = await tenant.createGroup('a', null);
    const b = await tenant.createGroup('b', a.id);
    await expect(tenant.reparent(a.id, b.id)).rejects.toThrow(/would create a cycle/);
  });

  it('rewrites the paths of an entire subtree on reparent', async () => {
    const tenant = await tenantFixture();
    const sales = await tenant.createGroup('sales', null);
    const engineering = await tenant.createGroup('engineering', null);
    const platform = await tenant.createGroup('platform', engineering.id);
    const infra = await tenant.createGroup('infra', platform.id);

    await tenant.reparent(platform.id, sales.id);

    const movedPlatform = await tenant.byPath('/sales/platform');
    const movedInfra = await tenant.byPath('/sales/platform/infra');
    expect(movedPlatform?.id).toBe(platform.id);
    expect(movedInfra?.id).toBe(infra.id);
  });
});

describe('group membership and roles', () => {
  it('grants a role mapped to the group the subject is in', async () => {
    const tenant = await tenantFixture();
    const subject = await tenant.insertSubject();
    const g = await tenant.createGroup('engineering', null);
    const role = await tenant.createRole('deployer');
    await tenant.mapRole(g.id, role.id);
    await tenant.addToSubject(subject, g.id);
    expect(await tenant.names(subject)).toEqual(['deployer']);
  });

  it('inherits a role mapped to an ancestor of the group the subject is in', async () => {
    const tenant = await tenantFixture();
    const subject = await tenant.insertSubject();
    const parent = await tenant.createGroup('engineering', null);
    const child = await tenant.createGroup('platform', parent.id);
    const role = await tenant.createRole('deployer');
    await tenant.mapRole(parent.id, role.id);
    await tenant.addToSubject(subject, child.id);
    expect(await tenant.names(subject)).toEqual(['deployer']);
  });

  it('does not grant a role mapped to a descendant', async () => {
    const tenant = await tenantFixture();
    const subject = await tenant.insertSubject();
    const parent = await tenant.createGroup('engineering', null);
    const child = await tenant.createGroup('platform', parent.id);
    const role = await tenant.createRole('deployer');
    await tenant.mapRole(child.id, role.id);
    await tenant.addToSubject(subject, parent.id);
    expect(await tenant.names(subject)).toEqual([]);
  });

  it('reports the paths of the groups a subject belongs to', async () => {
    const tenant = await tenantFixture();
    const subject = await tenant.insertSubject();
    const parent = await tenant.createGroup('engineering', null);
    const child = await tenant.createGroup('platform', parent.id);
    await tenant.addToSubject(subject, child.id);

    expect(await tenant.effectiveGroupPaths(subject)).toEqual(['/engineering/platform']);
  });

  it('finds no group from another tenant', async () => {
    const tenantA = await tenantFixture();
    const tenantB = await tenantFixture();
    const group = await tenantA.createGroup('engineering', null);
    // Confirms `create` actually produced a visible row under tenant A
    // before trusting that tenant B's null means isolation rather than a
    // seed that silently no-opped.
    expect(await tenantA.byPath('/engineering')).toMatchObject({ id: group.id });

    expect(await tenantB.byPath('/engineering')).toBeNull();
  });

  it('does not find another tenant’s group membership when computing effective group paths', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subjectId = await insertSubject(tx, tenantId);
        const group = await groupRepository(tx).create({
          tenantId,
          name: 'engineering',
          parentId: null,
        });
        await groupRepository(tx).addToSubject(subjectId, group.id);
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await effectiveGroupPaths(tx, seeded.subjectId);
        expect(found).toEqual(['/engineering']);
      },
      attempt: async (tx, seeded) => effectiveGroupPaths(tx, seeded.subjectId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});

describe('cross-tenant isolation of the writing methods', () => {
  it('cannot create a group as a child of another tenant’s group, and leaves that tenant’s tree unchanged', async () => {
    const tenantA = await tenantFixture();
    const tenantB = await tenantFixture();
    const parent = await tenantA.createGroup('engineering', null);
    expect(await tenantA.byPath('/engineering')).toMatchObject({ id: parent.id });

    await expect(
      withTenant(app.db, tenantB.tenantId, (tx) =>
        groupRepository(tx).create({
          tenantId: tenantB.tenantId,
          name: 'platform',
          parentId: parent.id,
        }),
      ),
    ).rejects.toThrow(/no group with id/);

    expect(await tenantA.byPath('/engineering/platform')).toBeNull();
  });

  it('cannot add a subject to another tenant’s group, and leaves that group’s membership unchanged', async () => {
    const tenantA = await tenantFixture();
    const tenantB = await tenantFixture();
    const group = await tenantA.createGroup('engineering', null);
    const subjectA = await tenantA.insertSubject();
    await tenantA.addToSubject(subjectA, group.id);
    expect(await tenantA.effectiveGroupPaths(subjectA)).toEqual(['/engineering']);

    const subjectB = await tenantB.insertSubject();
    await expect(
      withTenant(app.db, tenantB.tenantId, (tx) =>
        groupRepository(tx).addToSubject(subjectB, group.id),
      ),
    ).rejects.toThrow(/no group with id/);

    expect(await tenantA.effectiveGroupPaths(subjectA)).toEqual(['/engineering']);
    expect(await tenantB.effectiveGroupPaths(subjectB)).toEqual([]);
  });

  it('cannot map another tenant’s group to a role, and leaves that group’s roles unchanged', async () => {
    const tenantA = await tenantFixture();
    const tenantB = await tenantFixture();
    const group = await tenantA.createGroup('engineering', null);
    const roleA = await tenantA.createRole('deployer');
    await tenantA.mapRole(group.id, roleA.id);
    const subjectA = await tenantA.insertSubject();
    await tenantA.addToSubject(subjectA, group.id);
    expect(await tenantA.names(subjectA)).toEqual(['deployer']);

    const roleB = await tenantB.createRole('intruder');
    await expect(
      withTenant(app.db, tenantB.tenantId, (tx) => groupRepository(tx).mapRole(group.id, roleB.id)),
    ).rejects.toThrow(/no group with id/);

    expect(await tenantA.names(subjectA)).toEqual(['deployer']);
  });

  it('cannot reparent another tenant’s group, and leaves its path unchanged', async () => {
    const tenantA = await tenantFixture();
    const tenantB = await tenantFixture();
    const engineering = await tenantA.createGroup('engineering', null);
    const sales = await tenantA.createGroup('sales', null);
    const platform = await tenantA.createGroup('platform', engineering.id);
    expect(await tenantA.byPath('/engineering/platform')).toMatchObject({ id: platform.id });

    await expect(
      withTenant(app.db, tenantB.tenantId, (tx) =>
        groupRepository(tx).reparent(platform.id, sales.id),
      ),
    ).rejects.toThrow(/no group with id/);

    expect(await tenantA.byPath('/engineering/platform')).toMatchObject({ id: platform.id });
    expect(await tenantA.byPath('/sales/platform')).toBeNull();
  });
});

describe('a cyclic parent_id written behind the repository', () => {
  it('does not hang effectiveRoles or descendantsOf', async () => {
    const tenant = await tenantFixture();
    const a = await tenant.createGroup('a', null);
    const b = await tenant.createGroup('b', a.id);
    // Bypasses groupRepository.reparent, which refuses this cycle before
    // the SQL ever runs — writing it directly is what proves the query
    // itself terminates rather than only the guard in front of it.
    await withTenant(app.db, tenant.tenantId, (tx) =>
      tx.execute(sql`update groups set parent_id = ${b.id} where id = ${a.id}`),
    );

    const role = await tenant.createRole('deployer');
    await tenant.mapRole(a.id, role.id);
    const subject = await tenant.insertSubject();
    await tenant.addToSubject(subject, b.id);

    await expect(tenant.names(subject)).resolves.toEqual(['deployer']);

    const reachable = await withTenant(app.db, tenant.tenantId, (tx) => descendantsOf(tx, a.id));
    expect(reachable).toEqual(new Set([a.id, b.id]));
  }, 10_000);
});
