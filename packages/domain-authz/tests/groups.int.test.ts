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

// Each call gets its own freshly seeded realm, the same convention
// roles.int.test.ts uses for `create` — so one test's group names can never
// collide with another's under `UNIQUE (realm_id, path)`.
interface RealmFixture {
  realmId: string;
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

async function realmFixture(): Promise<RealmFixture> {
  const realmId = newId();
  await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));

  return {
    realmId,
    createGroup: (name, parentId) =>
      withRealm(app.db, realmId, (tx) => groupRepository(tx).create({ realmId, name, parentId })),
    reparent: (groupId, newParentId) =>
      withRealm(app.db, realmId, (tx) => groupRepository(tx).reparent(groupId, newParentId)),
    byPath: (path) => withRealm(app.db, realmId, (tx) => groupRepository(tx).byPath(path)),
    createRole: (name) =>
      withRealm(app.db, realmId, (tx) => roleRepository(tx).create({ realmId, name })),
    mapRole: (groupId, roleId) =>
      withRealm(app.db, realmId, (tx) => groupRepository(tx).mapRole(groupId, roleId)),
    insertSubject: () => withRealm(app.db, realmId, (tx) => insertSubject(tx, realmId)),
    addToSubject: (subjectId, groupId) =>
      withRealm(app.db, realmId, (tx) => groupRepository(tx).addToSubject(subjectId, groupId)),
    names: async (subjectId) => {
      const found = await withRealm(app.db, realmId, (tx) => effectiveRoles(tx, subjectId));
      return found.map((role) => role.name);
    },
    effectiveGroupPaths: (subjectId) =>
      withRealm(app.db, realmId, (tx) => effectiveGroupPaths(tx, subjectId)),
  };
}

describe('paths', () => {
  it('gives a top-level group a single-segment absolute path', async () => {
    const realm = await realmFixture();
    const g = await realm.createGroup('engineering', null);
    expect(g.path).toBe('/engineering');
  });

  it('builds a child path from its parent', async () => {
    const realm = await realmFixture();
    const parent = await realm.createGroup('engineering', null);
    const child = await realm.createGroup('platform', parent.id);
    expect(child.path).toBe('/engineering/platform');
  });

  it('permits the same name under two different parents', async () => {
    const realm = await realmFixture();
    const a = await realm.createGroup('engineering', null);
    const b = await realm.createGroup('sales', null);
    await expect(realm.createGroup('platform', a.id)).resolves.toMatchObject({
      path: '/engineering/platform',
    });
    await expect(realm.createGroup('platform', b.id)).resolves.toMatchObject({
      path: '/sales/platform',
    });
  });

  it('refuses a name containing the separator', async () => {
    const realm = await realmFixture();
    expect(await causeMessage(realm.createGroup('a/b', null))).toContain(
      'groups_name_has_no_slash',
    );
  });

  it('refuses a group that would be its own ancestor', async () => {
    const realm = await realmFixture();
    const a = await realm.createGroup('a', null);
    const b = await realm.createGroup('b', a.id);
    await expect(realm.reparent(a.id, b.id)).rejects.toThrow(/would create a cycle/);
  });

  it('rewrites the paths of an entire subtree on reparent', async () => {
    const realm = await realmFixture();
    const sales = await realm.createGroup('sales', null);
    const engineering = await realm.createGroup('engineering', null);
    const platform = await realm.createGroup('platform', engineering.id);
    const infra = await realm.createGroup('infra', platform.id);

    await realm.reparent(platform.id, sales.id);

    const movedPlatform = await realm.byPath('/sales/platform');
    const movedInfra = await realm.byPath('/sales/platform/infra');
    expect(movedPlatform?.id).toBe(platform.id);
    expect(movedInfra?.id).toBe(infra.id);
  });
});

describe('group membership and roles', () => {
  it('grants a role mapped to the group the subject is in', async () => {
    const realm = await realmFixture();
    const subject = await realm.insertSubject();
    const g = await realm.createGroup('engineering', null);
    const role = await realm.createRole('deployer');
    await realm.mapRole(g.id, role.id);
    await realm.addToSubject(subject, g.id);
    expect(await realm.names(subject)).toEqual(['deployer']);
  });

  it('inherits a role mapped to an ancestor of the group the subject is in', async () => {
    const realm = await realmFixture();
    const subject = await realm.insertSubject();
    const parent = await realm.createGroup('engineering', null);
    const child = await realm.createGroup('platform', parent.id);
    const role = await realm.createRole('deployer');
    await realm.mapRole(parent.id, role.id);
    await realm.addToSubject(subject, child.id);
    expect(await realm.names(subject)).toEqual(['deployer']);
  });

  it('does not grant a role mapped to a descendant', async () => {
    const realm = await realmFixture();
    const subject = await realm.insertSubject();
    const parent = await realm.createGroup('engineering', null);
    const child = await realm.createGroup('platform', parent.id);
    const role = await realm.createRole('deployer');
    await realm.mapRole(child.id, role.id);
    await realm.addToSubject(subject, parent.id);
    expect(await realm.names(subject)).toEqual([]);
  });

  it('reports the paths of the groups a subject belongs to', async () => {
    const realm = await realmFixture();
    const subject = await realm.insertSubject();
    const parent = await realm.createGroup('engineering', null);
    const child = await realm.createGroup('platform', parent.id);
    await realm.addToSubject(subject, child.id);

    expect(await realm.effectiveGroupPaths(subject)).toEqual(['/engineering/platform']);
  });

  it('finds no group from another realm', async () => {
    const realmA = await realmFixture();
    const realmB = await realmFixture();
    const group = await realmA.createGroup('engineering', null);
    // Confirms `create` actually produced a visible row under realm A
    // before trusting that realm B's null means isolation rather than a
    // seed that silently no-opped.
    expect(await realmA.byPath('/engineering')).toMatchObject({ id: group.id });

    expect(await realmB.byPath('/engineering')).toBeNull();
  });

  it('does not find another realm’s group membership when computing effective group paths', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subjectId = await insertSubject(tx, realmId);
        const group = await groupRepository(tx).create({
          realmId,
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

describe('cross-realm isolation of the writing methods', () => {
  it('cannot create a group as a child of another realm’s group, and leaves that realm’s tree unchanged', async () => {
    const realmA = await realmFixture();
    const realmB = await realmFixture();
    const parent = await realmA.createGroup('engineering', null);
    expect(await realmA.byPath('/engineering')).toMatchObject({ id: parent.id });

    await expect(
      withRealm(app.db, realmB.realmId, (tx) =>
        groupRepository(tx).create({
          realmId: realmB.realmId,
          name: 'platform',
          parentId: parent.id,
        }),
      ),
    ).rejects.toThrow(/no group with id/);

    expect(await realmA.byPath('/engineering/platform')).toBeNull();
  });

  it('cannot add a subject to another realm’s group, and leaves that group’s membership unchanged', async () => {
    const realmA = await realmFixture();
    const realmB = await realmFixture();
    const group = await realmA.createGroup('engineering', null);
    const subjectA = await realmA.insertSubject();
    await realmA.addToSubject(subjectA, group.id);
    expect(await realmA.effectiveGroupPaths(subjectA)).toEqual(['/engineering']);

    const subjectB = await realmB.insertSubject();
    await expect(
      withRealm(app.db, realmB.realmId, (tx) =>
        groupRepository(tx).addToSubject(subjectB, group.id),
      ),
    ).rejects.toThrow(/no group with id/);

    expect(await realmA.effectiveGroupPaths(subjectA)).toEqual(['/engineering']);
    expect(await realmB.effectiveGroupPaths(subjectB)).toEqual([]);
  });

  it('cannot map another realm’s group to a role, and leaves that group’s roles unchanged', async () => {
    const realmA = await realmFixture();
    const realmB = await realmFixture();
    const group = await realmA.createGroup('engineering', null);
    const roleA = await realmA.createRole('deployer');
    await realmA.mapRole(group.id, roleA.id);
    const subjectA = await realmA.insertSubject();
    await realmA.addToSubject(subjectA, group.id);
    expect(await realmA.names(subjectA)).toEqual(['deployer']);

    const roleB = await realmB.createRole('intruder');
    await expect(
      withRealm(app.db, realmB.realmId, (tx) => groupRepository(tx).mapRole(group.id, roleB.id)),
    ).rejects.toThrow(/no group with id/);

    expect(await realmA.names(subjectA)).toEqual(['deployer']);
  });

  it('cannot reparent another realm’s group, and leaves its path unchanged', async () => {
    const realmA = await realmFixture();
    const realmB = await realmFixture();
    const engineering = await realmA.createGroup('engineering', null);
    const sales = await realmA.createGroup('sales', null);
    const platform = await realmA.createGroup('platform', engineering.id);
    expect(await realmA.byPath('/engineering/platform')).toMatchObject({ id: platform.id });

    await expect(
      withRealm(app.db, realmB.realmId, (tx) =>
        groupRepository(tx).reparent(platform.id, sales.id),
      ),
    ).rejects.toThrow(/no group with id/);

    expect(await realmA.byPath('/engineering/platform')).toMatchObject({ id: platform.id });
    expect(await realmA.byPath('/sales/platform')).toBeNull();
  });
});

describe('a cyclic parent_id written behind the repository', () => {
  it('does not hang effectiveRoles or descendantsOf', async () => {
    const realm = await realmFixture();
    const a = await realm.createGroup('a', null);
    const b = await realm.createGroup('b', a.id);
    // Bypasses groupRepository.reparent, which refuses this cycle before
    // the SQL ever runs — writing it directly is what proves the query
    // itself terminates rather than only the guard in front of it.
    await withRealm(app.db, realm.realmId, (tx) =>
      tx.execute(sql`update groups set parent_id = ${b.id} where id = ${a.id}`),
    );

    const role = await realm.createRole('deployer');
    await realm.mapRole(a.id, role.id);
    const subject = await realm.insertSubject();
    await realm.addToSubject(subject, b.id);

    await expect(realm.names(subject)).resolves.toEqual(['deployer']);

    const reachable = await withRealm(app.db, realm.realmId, (tx) => descendantsOf(tx, a.id));
    expect(reachable).toEqual(new Set([a.id, b.id]));
  }, 10_000);
});
