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
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roleRepository, type RoleRecord } from '#/repository/roles';
import { clientScopeRoles, roleComposites, subjectRoles } from '#/schema/roles';

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

// @odudu/domain-authz never imports @odudu/domain-tenant or
// @odudu/domain-identity, so fixtures for their tables are inserted with raw
// SQL rather than through those packages' schemas.
async function insertClient(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into clients (id, realm_id, client_id, name, type, secret_hash)
    values (${id}, ${realmId}, ${`client-${id}`}, 'A client', 'public', null)
  `);
  return id;
}

async function insertSubject(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into subjects (id, realm_id, type) values (${id}, ${realmId}, 'user')
  `);
  return id;
}

async function insertClientScope(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into client_scopes (id, realm_id, name) values (${id}, ${realmId}, ${`scope-${id}`})
  `);
  return id;
}

// The driver only carries the fired constraint's name on the query error's
// `.cause.message`, not on the top-level message `.rejects.toThrow` reads —
// see client_oidc_config_redirect_uris_present's tests in protocol-oidc for
// the same idiom.
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

interface CreateOptions {
  name: string;
  realmId?: string;
  clientId?: string | null;
  defaultForNewSubjects?: boolean;
}

// A call that names an existing realmId assumes the caller already seeded
// it; a call with no realmId gets a fresh, freshly seeded realm of its own,
// so each test's roles are isolated from every other test's by default.
async function create(opts: CreateOptions): Promise<RoleRecord> {
  const realmId = opts.realmId ?? newId();
  if (opts.realmId === undefined) {
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
  }
  return withRealm(app.db, realmId, (tx) =>
    roleRepository(tx).create({
      realmId,
      name: opts.name,
      clientId: opts.clientId ?? null,
      ...(opts.defaultForNewSubjects !== undefined
        ? { defaultForNewSubjects: opts.defaultForNewSubjects }
        : {}),
    }),
  );
}

describe('role names', () => {
  it('refuses a colon, which would make the qualified form ambiguous', async () => {
    expect(await causeMessage(create({ name: 'reports-api:reader' }))).toContain(
      'roles_name_has_no_colon',
    );
  });

  it('refuses an empty name', async () => {
    expect(await causeMessage(create({ name: '' }))).toContain('roles_name_has_no_colon');
  });

  it('permits the same name as a realm role and as a client role', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const clientId = await withRealm(app.db, realmId, (tx) => insertClient(tx, realmId));

    await expect(create({ name: 'reader', realmId, clientId: null })).resolves.toBeDefined();
    await expect(create({ name: 'reader', realmId, clientId })).resolves.toBeDefined();
  });

  it('refuses two realm roles of the same name', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    await create({ name: 'admin', realmId, clientId: null });

    expect(await causeMessage(create({ name: 'admin', realmId, clientId: null }))).toContain(
      'roles_realm_name',
    );
  });

  it('refuses two client roles of the same name for the same client', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const clientId = await withRealm(app.db, realmId, (tx) => insertClient(tx, realmId));
    await create({ name: 'reader', realmId, clientId });

    expect(await causeMessage(create({ name: 'reader', realmId, clientId }))).toContain(
      'roles_client_name',
    );
  });
});

describe('create', () => {
  it('creates a role with the given fields', async () => {
    const role = await create({ name: 'admin' });
    expect(role).toMatchObject({
      name: 'admin',
      clientId: null,
      description: null,
      defaultForNewSubjects: false,
    });
    expect(role.id).toBeTruthy();
    expect(role.createdAt).toBeInstanceOf(Date);
  });

  it('refuses to create a role claiming another realm’s id, and leaves that realm untouched', async () => {
    const realmA = newId();
    const realmB = newId();
    await withRealm(app.db, realmA, (tx) => seedRealm(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));

    expect(
      await causeMessage(
        withRealm(app.db, realmB, (tx) =>
          roleRepository(tx).create({ realmId: realmA, name: 'admin' }),
        ),
      ),
    ).toMatch(/row-level security/i);

    const found = await withRealm(app.db, realmA, (tx) => roleRepository(tx).byName('admin', null));
    expect(found).toBeNull();
  });
});

describe('byName', () => {
  it('finds a role created in the realm', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    await create({ name: 'admin', realmId });

    const found = await withRealm(app.db, realmId, (tx) =>
      roleRepository(tx).byName('admin', null),
    );
    expect(found?.name).toBe('admin');
  });

  it('does not find another realm’s role by name', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        await roleRepository(tx).create({ realmId, name: 'admin' });
      },
      verifySeeded: async (tx) => {
        const found = await roleRepository(tx).byName('admin', null);
        expect(found).not.toBeNull();
      },
      attempt: async (tx) => roleRepository(tx).byName('admin', null),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('defaultsForRealm', () => {
  it('returns only roles marked default for new subjects', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    await create({ name: 'member', realmId, defaultForNewSubjects: true });
    await create({ name: 'admin', realmId, defaultForNewSubjects: false });

    const defaults = await withRealm(app.db, realmId, (tx) =>
      roleRepository(tx).defaultsForRealm(),
    );
    expect(defaults.map((role) => role.name)).toEqual(['member']);
  });

  it('does not return another realm’s default roles', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        await roleRepository(tx).create({ realmId, name: 'member', defaultForNewSubjects: true });
      },
      verifySeeded: async (tx) => {
        const defaults = await roleRepository(tx).defaultsForRealm();
        expect(defaults.map((role) => role.name)).toContain('member');
      },
      attempt: async (tx) => roleRepository(tx).defaultsForRealm(),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});

describe('composites', () => {
  it('refuses a role that includes itself', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const role = await create({ name: 'admin', realmId });

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(role.id, role.id)),
      ),
    ).toContain('role_composites_not_self');
  });

  it('refuses a two-node cycle the CHECK cannot see', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const a = await create({ name: 'a', realmId });
    const b = await create({ name: 'b', realmId });

    await withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(a.id, b.id));
    await expect(
      withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(b.id, a.id)),
    ).rejects.toThrow(/would create a cycle/);
  });

  it('refuses a three-node cycle the immediate-reverse check would miss', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const a = await create({ name: 'a', realmId });
    const b = await create({ name: 'b', realmId });
    const c = await create({ name: 'c', realmId });

    await withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(a.id, b.id));
    await withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(b.id, c.id));
    await expect(
      withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(c.id, a.id)),
    ).rejects.toThrow(/would create a cycle/);
  });

  it('permits a non-cyclic composite', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const a = await create({ name: 'a', realmId });
    const b = await create({ name: 'b', realmId });

    await expect(
      withRealm(app.db, realmId, (tx) => roleRepository(tx).addComposite(a.id, b.id)),
    ).resolves.toBeUndefined();
  });

  it('cannot attach another realm’s role as a composite, and leaves that realm’s graph unchanged', async () => {
    const realmA = newId();
    const realmB = newId();
    await withRealm(app.db, realmA, (tx) => seedRealm(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));
    const roleA = await create({ name: 'shared', realmId: realmA });
    const roleB = await create({ name: 'container', realmId: realmB });

    expect(
      await causeMessage(
        withRealm(app.db, realmB, (tx) => roleRepository(tx).addComposite(roleB.id, roleA.id)),
      ),
    ).toContain('role_composites_child_fk');

    const composites = await withRealm(app.db, realmA, (tx) =>
      tx.select().from(roleComposites).where(eq(roleComposites.childRoleId, roleA.id)),
    );
    expect(composites).toEqual([]);
  });
});

describe('assignToSubject', () => {
  it('assigns a role to a subject in the same realm', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const role = await create({ name: 'member', realmId });
    const subjectId = await withRealm(app.db, realmId, (tx) => insertSubject(tx, realmId));

    await expect(
      withRealm(app.db, realmId, (tx) => roleRepository(tx).assignToSubject(subjectId, role.id)),
    ).resolves.toBeUndefined();
  });

  it('cannot assign another realm’s role to a subject, and leaves that role unassigned', async () => {
    const realmA = newId();
    const realmB = newId();
    await withRealm(app.db, realmA, (tx) => seedRealm(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));
    const roleA = await create({ name: 'admin', realmId: realmA });
    const subjectB = await withRealm(app.db, realmB, (tx) => insertSubject(tx, realmB));

    await expect(
      withRealm(app.db, realmB, (tx) => roleRepository(tx).assignToSubject(subjectB, roleA.id)),
    ).rejects.toThrow(/no role with id/);

    const assignments = await withRealm(app.db, realmA, (tx) =>
      tx.select().from(subjectRoles).where(eq(subjectRoles.roleId, roleA.id)),
    );
    expect(assignments).toEqual([]);
  });
});

describe('mapToClientScope', () => {
  it('maps a role to a client scope in the same realm', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const role = await create({ name: 'member', realmId });
    const clientScopeId = await withRealm(app.db, realmId, (tx) => insertClientScope(tx, realmId));

    await expect(
      withRealm(app.db, realmId, (tx) =>
        roleRepository(tx).mapToClientScope(clientScopeId, role.id),
      ),
    ).resolves.toBeUndefined();
  });

  it('cannot map another realm’s role to a client scope, and leaves that role unmapped', async () => {
    const realmA = newId();
    const realmB = newId();
    await withRealm(app.db, realmA, (tx) => seedRealm(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));
    const roleA = await create({ name: 'admin', realmId: realmA });
    const clientScopeB = await withRealm(app.db, realmB, (tx) => insertClientScope(tx, realmB));

    await expect(
      withRealm(app.db, realmB, (tx) =>
        roleRepository(tx).mapToClientScope(clientScopeB, roleA.id),
      ),
    ).rejects.toThrow(/no role with id/);

    const mappings = await withRealm(app.db, realmA, (tx) =>
      tx.select().from(clientScopeRoles).where(eq(clientScopeRoles.roleId, roleA.id)),
    );
    expect(mappings).toEqual([]);
  });
});

describe('idsForClientScopes', () => {
  it('finds the role a client scope in the same realm is mapped to', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const role = await create({ name: 'member', realmId });
    const clientScopeId = await withRealm(app.db, realmId, (tx) => insertClientScope(tx, realmId));
    await withRealm(app.db, realmId, (tx) =>
      roleRepository(tx).mapToClientScope(clientScopeId, role.id),
    );

    const found = await withRealm(app.db, realmId, (tx) =>
      roleRepository(tx).idsForClientScopes([clientScopeId]),
    );
    expect(found).toEqual(new Set([role.id]));
  });

  it('does not find another realm’s mapping', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const role = await roleRepository(tx).create({ realmId, name: 'admin' });
        const clientScopeId = await insertClientScope(tx, realmId);
        await roleRepository(tx).mapToClientScope(clientScopeId, role.id);
        return { roleId: role.id, clientScopeId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await roleRepository(tx).idsForClientScopes([seeded.clientScopeId]);
        expect(found).toEqual(new Set([seeded.roleId]));
      },
      attempt: async (tx, seeded) => roleRepository(tx).idsForClientScopes([seeded.clientScopeId]),
      expectBlocked: (result) => {
        expect(result).toEqual(new Set());
      },
    });
  });
});
