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
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clientScopeRepository,
  type ClientScopeAssignment,
  type ClientScopeRecord,
} from '#/repository/client-scopes';
import { clientScopeAssignments } from '#/schema/client-scopes';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function insertClient(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    tenantId,
    clientId: `client-${clientId}`,
    name: 'A client',
    type: 'public',
    secretHash: null,
  });
  return clientId;
}

interface CreateOptions {
  name: string;
  tenantId?: string;
}

// A call that names an existing tenantId assumes the caller already seeded
// it (a second seed of the same id would collide on the primary key); a
// call with no tenantId gets a fresh, freshly seeded tenant of its own, so
// each test's scopes are isolated from every other test's by default.
async function create(opts: CreateOptions): Promise<ClientScopeRecord> {
  const tenantId = opts.tenantId ?? newId();
  if (opts.tenantId === undefined) {
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  }
  return withTenant(app.db, tenantId, (tx) =>
    clientScopeRepository(tx).create({ tenantId, name: opts.name }),
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
  it.each([
    ['a space, which is the scope separator', 'read write'],
    ['empty', ''],
    ['a double quote, one of the range exclusions', 'read"write'],
    ['a backslash, one of the range exclusions', 'read\\write'],
  ])('refuses a name containing %s', async (_label, name) => {
    expect(await causeMessage(create({ name }))).toContain('client_scopes_name_is_scope_token');
  });

  it('accepts the OIDC vocabulary and a resource-server style scope', async () => {
    for (const name of ['openid', 'profile', 'roles', 'reports:read']) {
      await expect(create({ name })).resolves.toMatchObject({ name });
    }
  });

  it('refuses a duplicate name in one tenant but permits it across tenants', async () => {
    const tenantA = newId();
    const tenantB = newId();
    await withTenant(app.db, tenantA, (tx) => seedTenant(tx, tenantA));
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));

    await create({ name: 'roles', tenantId: tenantA });
    expect(await causeMessage(create({ name: 'roles', tenantId: tenantA }))).toContain(
      'client_scopes_name_unique',
    );
    await expect(create({ name: 'roles', tenantId: tenantB })).resolves.toBeDefined();
  });
});

describe('allForTenant', () => {
  it('returns every scope created in the tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await create({ name: 'openid', tenantId });
    await create({ name: 'reports:read', tenantId });

    const scopes = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).allForTenant(),
    );

    expect(scopes.map((scope) => scope.name).sort()).toEqual(['openid', 'reports:read']);
  });

  it('does not return another tenant’s scopes', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
      },
      verifySeeded: async (tx) => {
        const scopes = await clientScopeRepository(tx).allForTenant();
        expect(scopes.map((scope) => scope.name)).toContain('openid');
      },
      attempt: async (tx) => clientScopeRepository(tx).allForTenant(),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});

describe('byName', () => {
  it('finds a scope created in the tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await create({ name: 'reports:read', tenantId });

    const found = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).byName('reports:read'),
    );

    expect(found?.name).toBe('reports:read');
  });

  it('cannot find another tenant’s scope by name', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await clientScopeRepository(tx).create({ tenantId, name: 'reports:read' });
        return 'reports:read';
      },
      verifySeeded: async (tx, name) => {
        const found = await clientScopeRepository(tx).byName(name);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, name) => clientScopeRepository(tx).byName(name),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('assignment', () => {
  it('refuses an assignment that is neither default nor optional', async () => {
    const tenantId = newId();

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        const clientId = await insertClient(tx, tenantId);
        const scope = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
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

  it('returns nothing for a client in another tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const clientInTenantA = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const clientId = await insertClient(tx, tenantA);
      const scope = await clientScopeRepository(tx).create({ tenantId: tenantA, name: 'openid' });
      await clientScopeRepository(tx).assign(clientId, scope.id, 'default');
      return clientId;
    });

    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));

    const scopes = await withTenant(app.db, tenantB, (tx) =>
      clientScopeRepository(tx).forClient(clientInTenantA),
    );
    expect(scopes).toEqual([]);
  });
});

describe('assignOrUpdate', () => {
  it('creates the assignment when none exists', async () => {
    const tenantId = newId();
    const { clientId, scopeId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const clientId = await insertClient(tx, tenantId);
      const scope = await clientScopeRepository(tx).create({ tenantId, name: 'roles' });
      return { clientId, scopeId: scope.id };
    });

    await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).assignOrUpdate(clientId, scopeId, 'optional'),
    );

    const scopes = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).forClient(clientId),
    );
    expect(scopes.map((scope) => scope.name)).toEqual(['roles']);
  });

  // Client creation assigns the tenant's default vocabulary before an
  // operator ever runs the seed CLI's assign-scope command, so the second
  // call this method exists for always lands on a row `assign` already
  // wrote — narrowing it is the point, not a collision to refuse.
  it('narrows an existing assignment instead of colliding with it', async () => {
    const tenantId = newId();
    const { clientId, scopeId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const clientId = await insertClient(tx, tenantId);
      const scope = await clientScopeRepository(tx).create({ tenantId, name: 'roles' });
      await clientScopeRepository(tx).assign(clientId, scope.id, 'default');
      return { clientId, scopeId: scope.id };
    });

    await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).assignOrUpdate(clientId, scopeId, 'optional'),
    );

    const rows = await owner.db
      .select({ assignment: clientScopeAssignments.assignment })
      .from(clientScopeAssignments)
      .where(
        and(
          eq(clientScopeAssignments.clientId, clientId),
          eq(clientScopeAssignments.clientScopeId, scopeId),
        ),
      );
    expect(rows[0]?.assignment).toBe('optional');
  });

  it('refuses a client from another tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const { clientId, scopeId } = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const clientId = await insertClient(tx, tenantA);
      const scope = await clientScopeRepository(tx).create({ tenantId: tenantA, name: 'roles' });
      return { clientId, scopeId: scope.id };
    });

    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));

    await expect(
      withTenant(app.db, tenantB, (tx) =>
        clientScopeRepository(tx).assignOrUpdate(clientId, scopeId, 'optional'),
      ),
    ).rejects.toThrow(/unknown client/);

    // The rejection alone is consistent with RLS filtering the client out
    // of tenant B's view; reading it back under its own tenant A confirms
    // that is really what happened, not some other failure that happened
    // to leave the assignment untouched too.
    const scopesAfter = await withTenant(app.db, tenantA, (tx) =>
      clientScopeRepository(tx).forClient(clientId),
    );
    expect(scopesAfter).toEqual([]);
  });
});
