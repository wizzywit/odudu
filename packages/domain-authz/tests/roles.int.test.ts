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

// @odudu/domain-authz never imports @odudu/domain-realm, so a client fixture
// is inserted with raw SQL rather than through that package's schema.
async function insertClient(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into clients (id, realm_id, client_id, name, type, secret_hash)
    values (${id}, ${realmId}, ${`client-${id}`}, 'A client', 'public', null)
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
    roleRepository(tx).create({ realmId, name: opts.name, clientId: opts.clientId ?? null }),
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
});

describe('realm isolation', () => {
  it('finds no role from another realm', async () => {
    const realmA = newId();
    const realmB = newId();
    await withRealm(app.db, realmA, (tx) => seedRealm(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));
    await create({ name: 'admin', realmId: realmA, clientId: null });

    const found = await withRealm(app.db, realmB, (tx) => roleRepository(tx).byName('admin', null));
    expect(found).toBeNull();
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
