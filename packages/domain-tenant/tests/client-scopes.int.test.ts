import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { CLIENT_SCOPE_LIMIT } from '@odudu/contracts/admin';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq, sql } from 'drizzle-orm';
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

describe('countUpTo', () => {
  it('counts the scopes of the tenant, and stops at the limit', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    for (const name of ['a', 'b', 'c']) await create({ name, tenantId });

    const counted = await withTenant(app.db, tenantId, async (tx) => ({
      all: await clientScopeRepository(tx).countUpTo(10),
      stopped: await clientScopeRepository(tx).countUpTo(2),
    }));

    expect(counted).toEqual({ all: 3, stopped: 2 });
  });

  it('counts no scope of another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await clientScopeRepository(tx).create({ tenantId, name: 'reports:read' });
      },
      verifySeeded: async (tx) => {
        expect(await clientScopeRepository(tx).countUpTo(10)).toBe(1);
      },
      attempt: async (tx) => clientScopeRepository(tx).countUpTo(10),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
    });
  });
});

describe('lockCreation', () => {
  it('locks the tenant row it is asked about, and finds no other tenant’s', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await clientScopeRepository(tx).lockCreation(tenantId)).toBe(true);
      },
      attempt: (tx, tenantId) => clientScopeRepository(tx).lockCreation(tenantId),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });
});

describe('byNames', () => {
  it('finds the scopes named, in one read, and skips a name that is no scope', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await create({ name: 'reports:read', tenantId });
    await create({ name: 'reports:write', tenantId });

    const found = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).byNames(['reports:read', 'reports:write', 'nothing']),
    );

    expect(found.map((scope) => scope.name).sort()).toEqual(['reports:read', 'reports:write']);
  });

  it('answers in the order the names were given, each once', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    for (const name of ['b', 'a', 'c', 'd']) await create({ name, tenantId });

    const found = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).byNames(['d', 'b', 'x', 'a', 'd', 'c']),
    );

    expect(found.map((scope) => scope.name)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('cannot find another tenant’s scopes by name', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await clientScopeRepository(tx).create({ tenantId, name: 'reports:read' });
        return ['reports:read'];
      },
      verifySeeded: async (tx, names) => {
        expect(await clientScopeRepository(tx).byNames(names)).toHaveLength(1);
      },
      attempt: async (tx, names) => clientScopeRepository(tx).byNames(names),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
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

describe('unassign', () => {
  it('removes an existing assignment and reports true', async () => {
    const tenantId = newId();
    const { clientId, scopeId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const clientId = await insertClient(tx, tenantId);
      const scope = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
      await clientScopeRepository(tx).assign(clientId, scope.id, 'default');
      return { clientId, scopeId: scope.id };
    });

    const removed = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).unassign(clientId, scopeId),
    );
    expect(removed).toBe(true);

    const scopes = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).forClient(clientId),
    );
    expect(scopes).toEqual([]);
  });

  it('reports false when no such assignment exists', async () => {
    const tenantId = newId();
    const { clientId, scopeId } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const clientId = await insertClient(tx, tenantId);
      const scope = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
      return { clientId, scopeId: scope.id };
    });

    const removed = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).unassign(clientId, scopeId),
    );
    expect(removed).toBe(false);
  });

  it('cannot unassign another tenant’s client scope assignment', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientId = await insertClient(tx, tenantId);
        const scope = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
        await clientScopeRepository(tx).assign(clientId, scope.id, 'default');
        return { clientId, scopeId: scope.id };
      },
      verifySeeded: async (tx, seeded) => {
        const scopes = await clientScopeRepository(tx).forClient(seeded.clientId);
        expect(scopes.map((scope) => scope.name)).toContain('openid');
      },
      attempt: async (tx, seeded) =>
        clientScopeRepository(tx).unassign(seeded.clientId, seeded.scopeId),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const scopes = await clientScopeRepository(tx).forClient(seeded.clientId);
        expect(scopes.map((scope) => scope.name)).toContain('openid');
      },
    });
  });
});

describe('byId', () => {
  it('finds a scope created in the same tenant', async () => {
    const scope = await create({ name: 'profile' });
    const found = await withTenant(app.db, scope.tenantId, (tx) =>
      clientScopeRepository(tx).byId(scope.id),
    );
    expect(found?.id).toBe(scope.id);
  });

  it('does not find another tenant’s scope', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return clientScopeRepository(tx).create({ tenantId, name: 'profile' });
      },
      verifySeeded: async (tx, scope) => {
        expect(await clientScopeRepository(tx).byId(scope.id)).not.toBeNull();
      },
      attempt: async (tx, scope) => clientScopeRepository(tx).byId(scope.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('amend', () => {
  it('replaces description and the include flags', async () => {
    const scope = await create({ name: 'profile' });
    const amended = await withTenant(app.db, scope.tenantId, (tx) =>
      clientScopeRepository(tx).amend(scope.id, {
        description: 'profile claims',
        includeInIdToken: false,
        includeInAccessToken: true,
      }),
    );
    expect(amended.description).toBe('profile claims');
    expect(amended.includeInIdToken).toBe(false);
    expect(amended.includeInAccessToken).toBe(true);
  });

  it('throws client_scope_not_found for another tenant’s scope, and leaves it unamended', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return clientScopeRepository(tx).create({
          tenantId,
          name: 'profile',
          description: 'original',
        });
      },
      verifySeeded: async (tx, scope) => {
        expect((await clientScopeRepository(tx).byId(scope.id))?.description).toBe('original');
      },
      attempt: async (tx, scope) => {
        try {
          await clientScopeRepository(tx).amend(scope.id, { description: 'hijacked' });
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyTenantAUnaffected: async (tx, scope) => {
        expect((await clientScopeRepository(tx).byId(scope.id))?.description).toBe('original');
      },
    });
  });
});

// client_scope_assignments_scope_fk (0016_client_scopes.sql) cascades: the
// migration names ON DELETE CASCADE, not RESTRICT, so an assigned scope's
// row disappears along with the assignment rather than refusing the delete.
describe('delete', () => {
  it('cascades: removes an assigned scope and its client assignment together', async () => {
    const scope = await create({ name: 'profile' });
    const clientId = await withTenant(app.db, scope.tenantId, (tx) =>
      insertClient(tx, scope.tenantId),
    );
    await withTenant(app.db, scope.tenantId, (tx) =>
      clientScopeRepository(tx).assign(clientId, scope.id, 'default'),
    );

    const deleted = await withTenant(app.db, scope.tenantId, (tx) =>
      clientScopeRepository(tx).delete(scope.id),
    );
    expect(deleted).toBe(true);

    const assignments = await withTenant(app.db, scope.tenantId, (tx) =>
      clientScopeRepository(tx).forClient(clientId),
    );
    expect(assignments).toEqual([]);
  });

  it('reports false for an id no scope holds', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const deleted = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).delete(newId()),
    );
    expect(deleted).toBe(false);
  });

  it('cannot delete another tenant’s scope', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return clientScopeRepository(tx).create({ tenantId, name: 'profile' });
      },
      verifySeeded: async (tx, scope) => {
        expect(await clientScopeRepository(tx).byId(scope.id)).not.toBeNull();
      },
      attempt: async (tx, scope) => clientScopeRepository(tx).delete(scope.id),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, scope) => {
        expect(await clientScopeRepository(tx).byId(scope.id)).not.toBeNull();
      },
    });
  });
});

describe('countAssignedUpTo', () => {
  it('counts what one client carries, and stops at the limit', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const clientId = await withTenant(app.db, tenantId, (tx) => insertClient(tx, tenantId));
    for (const name of ['a', 'b', 'c']) {
      const scope = await create({ name, tenantId });
      await withTenant(app.db, tenantId, (tx) =>
        clientScopeRepository(tx).assign(clientId, scope.id, 'default'),
      );
    }
    const repository = (tx: TenantScopedDatabase) => clientScopeRepository(tx);
    expect(
      await withTenant(app.db, tenantId, (tx) => repository(tx).countAssignedUpTo(clientId, 10)),
    ).toBe(3);
    expect(
      await withTenant(app.db, tenantId, (tx) => repository(tx).countAssignedUpTo(clientId, 2)),
    ).toBe(2);
  });

  it('counts nothing for another tenant’s client', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientId = await insertClient(tx, tenantId);
        const scope = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
        await clientScopeRepository(tx).assign(clientId, scope.id, 'default');
        return clientId;
      },
      verifySeeded: async (tx, clientId) => {
        expect(await clientScopeRepository(tx).countAssignedUpTo(clientId, 10)).toBe(1);
      },
      attempt: async (tx, clientId) => clientScopeRepository(tx).countAssignedUpTo(clientId, 10),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
    });
  });
});

describe('countDefaultsUpTo', () => {
  it('counts the scopes the tenant marks for every new client, and stops at the limit', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = clientScopeRepository(tx);
      await repository.create({ tenantId, name: 'a', defaultClientAssignment: 'default' });
      await repository.create({ tenantId, name: 'b', defaultClientAssignment: 'optional' });
      await repository.create({ tenantId, name: 'unmarked' });
    });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        clientScopeRepository(tx).countDefaultsUpTo(tenantId, 10),
      ),
    ).toBe(2);
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        clientScopeRepository(tx).countDefaultsUpTo(tenantId, 1),
      ),
    ).toBe(1);
  });

  it('counts nothing for another tenant’s scopes', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await clientScopeRepository(tx).create({
          tenantId,
          name: 'openid',
          defaultClientAssignment: 'default',
        });
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await clientScopeRepository(tx).countDefaultsUpTo(tenantId, 10)).toBe(1);
      },
      attempt: async (tx, tenantId) => clientScopeRepository(tx).countDefaultsUpTo(tenantId, 10),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
    });
  });

  it('counts only the tenant named when the connection sees every tenant', async () => {
    const mine = newId();
    const theirs = newId();
    for (const tenantId of [mine, theirs]) {
      await withTenant(owner.db, tenantId, (tx) => seedTenant(tx, tenantId));
      await withTenant(owner.db, tenantId, async (tx) => {
        await clientScopeRepository(tx).create({
          tenantId,
          name: 'marked',
          defaultClientAssignment: 'default',
        });
      });
    }
    expect(
      await withTenant(owner.db, mine, (tx) =>
        clientScopeRepository(tx).countDefaultsUpTo(mine, 10),
      ),
    ).toBe(1);
  });
});

// The bound is held under a lock, so two writers at the edge are not both let through.
async function finishesWhileHeld<R>(
  tenantId: string,
  lock: (tx: TenantScopedDatabase) => Promise<unknown>,
  act: () => Promise<R>,
  wait = 400,
): Promise<boolean> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const holder = withTenant(app.db, tenantId, async (tx) => {
    await lock(tx);
    signalLocked();
    await held;
  });
  await locked;
  const pending = act();
  const early = await Promise.race([
    pending.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, wait);
    }),
  ]);
  release();
  await holder;
  await pending.catch(() => undefined);
  return early;
}

describe('the limit under concurrent writers', () => {
  it('waits for a lock on the client before it counts what the client carries', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const clientId = await withTenant(app.db, tenantId, (tx) => insertClient(tx, tenantId));
    const scope = await create({ name: 'waits', tenantId });
    const early = await finishesWhileHeld(
      tenantId,
      (tx) => tx.execute(sql`select id from clients where id = ${clientId} for no key update`),
      () =>
        withTenant(app.db, tenantId, (tx) =>
          clientScopeRepository(tx).assignOrUpdate(clientId, scope.id, 'default'),
        ),
    );
    expect(early).toBe(false);
  });

  it('waits for a lock on the tenant before it counts what is marked, on create and on amend', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const plain = await create({ name: 'plain', tenantId });
    const lock = (tx: TenantScopedDatabase) =>
      tx.execute(sql`select id from tenants where id = ${tenantId} for no key update`);
    const created = await finishesWhileHeld(tenantId, lock, () =>
      withTenant(app.db, tenantId, (tx) =>
        clientScopeRepository(tx).create({
          tenantId,
          name: 'marked-on-create',
          defaultClientAssignment: 'default',
        }),
      ),
    );
    expect(created).toBe(false);
    const amended = await finishesWhileHeld(tenantId, lock, () =>
      withTenant(app.db, tenantId, (tx) =>
        clientScopeRepository(tx).amend(plain.id, { defaultClientAssignment: 'default' }),
      ),
    );
    expect(amended).toBe(false);
  });

  it('lets exactly one of two assigns at the edge in', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const clientId = await withTenant(app.db, tenantId, (tx) => insertClient(tx, tenantId));
    await owner.sql`
      insert into client_scopes (id, tenant_id, name)
      select gen_random_uuid(), ${tenantId}, 'filler-' || g from generate_series(1, ${CLIENT_SCOPE_LIMIT} + 1) g`;
    await owner.sql`
      insert into client_scope_assignments (tenant_id, client_id, client_scope_id, assignment)
      select ${tenantId}, ${clientId}, id, 'optional' from client_scopes
       where tenant_id = ${tenantId} order by name limit ${CLIENT_SCOPE_LIMIT} - 1`;
    const left = await owner.sql<{ id: string }[]>`
      select id from client_scopes where tenant_id = ${tenantId}
         and id not in (select client_scope_id from client_scope_assignments where client_id = ${clientId}) limit 2`;
    const outcomes = await Promise.allSettled(
      left.map((scope) =>
        withTenant(app.db, tenantId, (tx) =>
          clientScopeRepository(tx).assignOrUpdate(clientId, scope.id, 'default'),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [held] = await owner.sql<{ n: string }[]>`
      select count(*) as n from client_scope_assignments where client_id = ${clientId}`;
    expect(held?.n).toBe(String(CLIENT_SCOPE_LIMIT));
  });

  it('lets exactly one of two marks at the edge in', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await owner.sql`
      insert into client_scopes (id, tenant_id, name, default_client_assignment)
      select gen_random_uuid(), ${tenantId}, 'marked-' || g, 'default' from generate_series(1, ${CLIENT_SCOPE_LIMIT} - 1) g`;
    const first = await create({ name: 'first', tenantId });
    const second = await create({ name: 'second', tenantId });
    const outcomes = await Promise.allSettled(
      [first, second].map((scope) =>
        withTenant(app.db, tenantId, (tx) =>
          clientScopeRepository(tx).amend(scope.id, { defaultClientAssignment: 'default' }),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const [marked] = await owner.sql<{ n: string }[]>`
      select count(*) as n from client_scopes
       where tenant_id = ${tenantId} and default_client_assignment is not null`;
    expect(marked?.n).toBe(String(CLIENT_SCOPE_LIMIT));
  });
});
