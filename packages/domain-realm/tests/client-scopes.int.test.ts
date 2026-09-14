import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clientScopeRepository,
  type ClientScopeAssignment,
  type ClientScopeRecord,
} from '#/repository/client-scopes';
import { clients } from '#/schema/clients';

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

async function insertClient(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    realmId,
    clientId: `client-${clientId}`,
    name: 'A client',
    type: 'public',
    secretHash: null,
  });
  return clientId;
}

interface CreateOptions {
  name: string;
  realmId?: string;
}

// A call that names an existing realmId assumes the caller already seeded
// it (a second seed of the same id would collide on the primary key); a
// call with no realmId gets a fresh, freshly seeded realm of its own, so
// each test's scopes are isolated from every other test's by default.
async function create(opts: CreateOptions): Promise<ClientScopeRecord> {
  const realmId = opts.realmId ?? newId();
  if (opts.realmId === undefined) {
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
  }
  return withRealm(app.db, realmId, (tx) =>
    clientScopeRepository(tx).create({ realmId, name: opts.name }),
  );
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

describe('client scope names', () => {
  it('refuses a name containing a space, which is the scope separator', async () => {
    expect(await causeMessage(create({ name: 'read write' }))).toContain(
      'client_scopes_name_is_scope_token',
    );
  });

  it('refuses an empty name', async () => {
    expect(await causeMessage(create({ name: '' }))).toContain('client_scopes_name_is_scope_token');
  });

  it('accepts the OIDC vocabulary and a resource-server style scope', async () => {
    for (const name of ['openid', 'profile', 'roles', 'reports:read']) {
      await expect(create({ name })).resolves.toMatchObject({ name });
    }
  });

  it('refuses a duplicate name in one realm but permits it across realms', async () => {
    const realmA = newId();
    const realmB = newId();
    await withRealm(app.db, realmA, (tx) => seedRealm(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));

    await create({ name: 'roles', realmId: realmA });
    expect(await causeMessage(create({ name: 'roles', realmId: realmA }))).toContain(
      'client_scopes_name_unique',
    );
    await expect(create({ name: 'roles', realmId: realmB })).resolves.toBeDefined();
  });
});

describe('assignment', () => {
  it('refuses an assignment that is neither default nor optional', async () => {
    const realmId = newId();

    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        await seedRealm(tx, realmId);
        const clientId = await insertClient(tx, realmId);
        const scope = await clientScopeRepository(tx).create({ realmId, name: 'openid' });
        await clientScopeRepository(tx).assign(
          clientId,
          scope.id,
          'sometimes' as ClientScopeAssignment,
        );
      });
      expect.unreachable('expected the invalid assignment to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('client_scope_assignments_assignment_check');
  });

  it('returns nothing for a client in another realm', async () => {
    const realmA = newId();
    const realmB = newId();

    const clientInRealmA = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      const clientId = await insertClient(tx, realmA);
      const scope = await clientScopeRepository(tx).create({ realmId: realmA, name: 'openid' });
      await clientScopeRepository(tx).assign(clientId, scope.id, 'default');
      return clientId;
    });

    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));

    const scopes = await withRealm(app.db, realmB, (tx) =>
      clientScopeRepository(tx).forClient(clientInRealmA),
    );
    expect(scopes).toEqual([]);
  });
});
