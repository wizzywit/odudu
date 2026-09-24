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
import { and, eq, sql } from 'drizzle-orm';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

// @odudu/domain-authz never imports @odudu/domain-tenant or
// @odudu/domain-identity, so fixtures for their tables are inserted with raw
// SQL rather than through those packages' schemas.
async function insertClient(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into clients (id, tenant_id, client_id, name, type, secret_hash)
    values (${id}, ${tenantId}, ${`client-${id}`}, 'A client', 'public', null)
  `);
  return id;
}

async function insertSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into subjects (id, tenant_id, type) values (${id}, ${tenantId}, 'user')
  `);
  return id;
}

async function insertClientScope(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into client_scopes (id, tenant_id, name) values (${id}, ${tenantId}, ${`scope-${id}`})
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
  tenantId?: string;
  clientId?: string | null;
  defaultForNewSubjects?: boolean;
}

// A call that names an existing tenantId assumes the caller already seeded
// it; a call with no tenantId gets a fresh, freshly seeded tenant of its own,
// so each test's roles are isolated from every other test's by default.
async function create(opts: CreateOptions): Promise<RoleRecord> {
  const tenantId = opts.tenantId ?? newId();
  if (opts.tenantId === undefined) {
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  }
  return withTenant(app.db, tenantId, (tx) =>
    roleRepository(tx).create({
      tenantId,
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

  it('permits the same name as a tenant role and as a client role', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const clientId = await withTenant(app.db, tenantId, (tx) => insertClient(tx, tenantId));

    await expect(create({ name: 'reader', tenantId, clientId: null })).resolves.toBeDefined();
    await expect(create({ name: 'reader', tenantId, clientId })).resolves.toBeDefined();
  });

  it('refuses two tenant roles of the same name', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await create({ name: 'admin', tenantId, clientId: null });

    expect(await causeMessage(create({ name: 'admin', tenantId, clientId: null }))).toContain(
      'roles_tenant_name',
    );
  });

  it('refuses two client roles of the same name for the same client', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const clientId = await withTenant(app.db, tenantId, (tx) => insertClient(tx, tenantId));
    await create({ name: 'reader', tenantId, clientId });

    expect(await causeMessage(create({ name: 'reader', tenantId, clientId }))).toContain(
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

  it('refuses to create a role claiming another tenant’s id, and leaves that tenant untouched', async () => {
    const tenantA = newId();
    const tenantB = newId();
    await withTenant(app.db, tenantA, (tx) => seedTenant(tx, tenantA));
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));

    expect(
      await causeMessage(
        withTenant(app.db, tenantB, (tx) =>
          roleRepository(tx).create({ tenantId: tenantA, name: 'admin' }),
        ),
      ),
    ).toMatch(/row-level security/i);

    const found = await withTenant(app.db, tenantA, (tx) =>
      roleRepository(tx).byName('admin', null),
    );
    expect(found).toBeNull();
  });
});

describe('byName', () => {
  it('finds a role created in the tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await create({ name: 'admin', tenantId });

    const found = await withTenant(app.db, tenantId, (tx) =>
      roleRepository(tx).byName('admin', null),
    );
    expect(found?.name).toBe('admin');
  });

  it('does not find another tenant’s role by name', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await roleRepository(tx).create({ tenantId, name: 'admin' });
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

describe('defaultsForTenant', () => {
  it('returns only roles marked default for new subjects', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await create({ name: 'member', tenantId, defaultForNewSubjects: true });
    await create({ name: 'admin', tenantId, defaultForNewSubjects: false });

    const defaults = await withTenant(app.db, tenantId, (tx) =>
      roleRepository(tx).defaultsForTenant(),
    );
    expect(defaults.map((role) => role.name)).toEqual(['member']);
  });

  it('does not return another tenant’s default roles', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await roleRepository(tx).create({ tenantId, name: 'member', defaultForNewSubjects: true });
      },
      verifySeeded: async (tx) => {
        const defaults = await roleRepository(tx).defaultsForTenant();
        expect(defaults.map((role) => role.name)).toContain('member');
      },
      attempt: async (tx) => roleRepository(tx).defaultsForTenant(),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});

describe('composites', () => {
  it('refuses a role that includes itself', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const role = await create({ name: 'admin', tenantId });

    expect(
      await causeMessage(
        withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(role.id, role.id)),
      ),
    ).toContain('role_composites_not_self');
  });

  it('refuses a two-node cycle the CHECK cannot see', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const a = await create({ name: 'a', tenantId });
    const b = await create({ name: 'b', tenantId });

    await withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(a.id, b.id));
    await expect(
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(b.id, a.id)),
    ).rejects.toThrow(/would create a cycle/);
  });

  it('refuses a three-node cycle the immediate-reverse check would miss', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const a = await create({ name: 'a', tenantId });
    const b = await create({ name: 'b', tenantId });
    const c = await create({ name: 'c', tenantId });

    await withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(a.id, b.id));
    await withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(b.id, c.id));
    await expect(
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(c.id, a.id)),
    ).rejects.toThrow(/would create a cycle/);
  });

  it('permits a non-cyclic composite', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const a = await create({ name: 'a', tenantId });
    const b = await create({ name: 'b', tenantId });

    await expect(
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(a.id, b.id)),
    ).resolves.toBeUndefined();
  });

  it('repeating the same composite is a no-op', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const a = await create({ name: 'a', tenantId });
    const b = await create({ name: 'b', tenantId });

    await withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(a.id, b.id));
    await expect(
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).addComposite(a.id, b.id)),
    ).resolves.toBeUndefined();

    const composites = await withTenant(app.db, tenantId, (tx) =>
      tx
        .select()
        .from(roleComposites)
        .where(and(eq(roleComposites.parentRoleId, a.id), eq(roleComposites.childRoleId, b.id))),
    );
    expect(composites).toHaveLength(1);
  });

  it('cannot attach another tenant’s role as a composite, and leaves that tenant’s graph unchanged', async () => {
    const tenantA = newId();
    const tenantB = newId();
    await withTenant(app.db, tenantA, (tx) => seedTenant(tx, tenantA));
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));
    const roleA = await create({ name: 'shared', tenantId: tenantA });
    const roleB = await create({ name: 'container', tenantId: tenantB });

    expect(
      await causeMessage(
        withTenant(app.db, tenantB, (tx) => roleRepository(tx).addComposite(roleB.id, roleA.id)),
      ),
    ).toContain('role_composites_child_fk');

    const composites = await withTenant(app.db, tenantA, (tx) =>
      tx.select().from(roleComposites).where(eq(roleComposites.childRoleId, roleA.id)),
    );
    expect(composites).toEqual([]);
  });
});

describe('assignToSubject', () => {
  it('assigns a role to a subject in the same tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const role = await create({ name: 'member', tenantId });
    const subjectId = await withTenant(app.db, tenantId, (tx) => insertSubject(tx, tenantId));

    await expect(
      withTenant(app.db, tenantId, (tx) => roleRepository(tx).assignToSubject(subjectId, role.id)),
    ).resolves.toBeUndefined();
  });

  it('cannot assign another tenant’s role to a subject, and leaves that role unassigned', async () => {
    const tenantA = newId();
    const tenantB = newId();
    await withTenant(app.db, tenantA, (tx) => seedTenant(tx, tenantA));
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));
    const roleA = await create({ name: 'admin', tenantId: tenantA });
    const subjectB = await withTenant(app.db, tenantB, (tx) => insertSubject(tx, tenantB));

    await expect(
      withTenant(app.db, tenantB, (tx) => roleRepository(tx).assignToSubject(subjectB, roleA.id)),
    ).rejects.toThrow(/no role with id/);

    const assignments = await withTenant(app.db, tenantA, (tx) =>
      tx.select().from(subjectRoles).where(eq(subjectRoles.roleId, roleA.id)),
    );
    expect(assignments).toEqual([]);
  });
});

describe('mapToClientScope', () => {
  it('maps a role to a client scope in the same tenant', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const role = await create({ name: 'member', tenantId });
    const clientScopeId = await withTenant(app.db, tenantId, (tx) =>
      insertClientScope(tx, tenantId),
    );

    await expect(
      withTenant(app.db, tenantId, (tx) =>
        roleRepository(tx).mapToClientScope(clientScopeId, role.id),
      ),
    ).resolves.toBeUndefined();
  });

  it('cannot map another tenant’s role to a client scope, and leaves that role unmapped', async () => {
    const tenantA = newId();
    const tenantB = newId();
    await withTenant(app.db, tenantA, (tx) => seedTenant(tx, tenantA));
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));
    const roleA = await create({ name: 'admin', tenantId: tenantA });
    const clientScopeB = await withTenant(app.db, tenantB, (tx) => insertClientScope(tx, tenantB));

    await expect(
      withTenant(app.db, tenantB, (tx) =>
        roleRepository(tx).mapToClientScope(clientScopeB, roleA.id),
      ),
    ).rejects.toThrow(/no role with id/);

    const mappings = await withTenant(app.db, tenantA, (tx) =>
      tx.select().from(clientScopeRoles).where(eq(clientScopeRoles.roleId, roleA.id)),
    );
    expect(mappings).toEqual([]);
  });
});

describe('idsForClientScopes', () => {
  it('finds the role a client scope in the same tenant is mapped to', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const role = await create({ name: 'member', tenantId });
    const clientScopeId = await withTenant(app.db, tenantId, (tx) =>
      insertClientScope(tx, tenantId),
    );
    await withTenant(app.db, tenantId, (tx) =>
      roleRepository(tx).mapToClientScope(clientScopeId, role.id),
    );

    const found = await withTenant(app.db, tenantId, (tx) =>
      roleRepository(tx).idsForClientScopes([clientScopeId]),
    );
    expect(found).toEqual(new Set([role.id]));
  });

  it('does not find another tenant’s mapping', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const role = await roleRepository(tx).create({ tenantId, name: 'admin' });
        const clientScopeId = await insertClientScope(tx, tenantId);
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

describe('byId', () => {
  it('finds a role created in the same tenant', async () => {
    const role = await create({ name: 'member' });
    const found = await withTenant(app.db, role.tenantId, (tx) => roleRepository(tx).byId(role.id));
    expect(found?.id).toBe(role.id);
  });

  it('does not find another tenant’s role', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return roleRepository(tx).create({ tenantId, name: 'admin' });
      },
      verifySeeded: async (tx, role) => {
        const found = await roleRepository(tx).byId(role.id);
        expect(found?.id).toBe(role.id);
      },
      attempt: async (tx, role) => roleRepository(tx).byId(role.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('amend', () => {
  it('replaces the description', async () => {
    const role = await create({ name: 'member' });
    const amended = await withTenant(app.db, role.tenantId, (tx) =>
      roleRepository(tx).amend(role.id, { description: 'members of the org' }),
    );
    expect(amended.description).toBe('members of the org');
  });

  it('throws role_not_found for another tenant’s role, and leaves it unamended', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return roleRepository(tx).create({ tenantId, name: 'admin', description: 'original' });
      },
      verifySeeded: async (tx, role) => {
        const found = await roleRepository(tx).byId(role.id);
        expect(found?.description).toBe('original');
      },
      attempt: async (tx, role) => {
        try {
          await roleRepository(tx).amend(role.id, { description: 'hijacked' });
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyTenantAUnaffected: async (tx, role) => {
        const found = await roleRepository(tx).byId(role.id);
        expect(found?.description).toBe('original');
      },
    });
  });
});

describe('delete', () => {
  it('removes the role and its composite edges', async () => {
    const parent = await create({ name: 'parent' });
    const child = await create({ tenantId: parent.tenantId, name: 'child' });
    await withTenant(app.db, parent.tenantId, (tx) =>
      roleRepository(tx).addComposite(parent.id, child.id),
    );

    const deleted = await withTenant(app.db, parent.tenantId, (tx) =>
      roleRepository(tx).delete(parent.id),
    );
    expect(deleted).toBe(true);

    const edges = await withTenant(app.db, parent.tenantId, (tx) =>
      tx.select().from(roleComposites).where(eq(roleComposites.parentRoleId, parent.id)),
    );
    expect(edges).toEqual([]);
  });

  it('reports false for an id no role holds', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const deleted = await withTenant(app.db, tenantId, (tx) => roleRepository(tx).delete(newId()));
    expect(deleted).toBe(false);
  });

  it('cannot delete another tenant’s role', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return roleRepository(tx).create({ tenantId, name: 'admin' });
      },
      verifySeeded: async (tx, role) => {
        const found = await roleRepository(tx).byId(role.id);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, role) => roleRepository(tx).delete(role.id),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, role) => {
        const found = await roleRepository(tx).byId(role.id);
        expect(found).not.toBeNull();
      },
    });
  });
});

describe('setClientScopeRoles', () => {
  it('replaces the role set a client scope maps to', async () => {
    const roleA = await create({ name: 'a' });
    const roleB = await create({ tenantId: roleA.tenantId, name: 'b' });
    const clientScopeId = await withTenant(app.db, roleA.tenantId, (tx) =>
      insertClientScope(tx, roleA.tenantId),
    );

    await withTenant(app.db, roleA.tenantId, (tx) =>
      roleRepository(tx).setClientScopeRoles(clientScopeId, [roleA.id]),
    );
    const first = await withTenant(app.db, roleA.tenantId, (tx) =>
      roleRepository(tx).idsForClientScopes([clientScopeId]),
    );
    expect(first).toEqual(new Set([roleA.id]));

    await withTenant(app.db, roleA.tenantId, (tx) =>
      roleRepository(tx).setClientScopeRoles(clientScopeId, [roleB.id]),
    );
    const second = await withTenant(app.db, roleA.tenantId, (tx) =>
      roleRepository(tx).idsForClientScopes([clientScopeId]),
    );
    expect(second).toEqual(new Set([roleB.id]));
  });

  it('cannot replace another tenant’s mapping', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const role = await roleRepository(tx).create({ tenantId, name: 'admin' });
        const clientScopeId = await insertClientScope(tx, tenantId);
        await roleRepository(tx).setClientScopeRoles(clientScopeId, [role.id]);
        return { roleId: role.id, clientScopeId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await roleRepository(tx).idsForClientScopes([seeded.clientScopeId]);
        expect(found).toEqual(new Set([seeded.roleId]));
      },
      attempt: async (tx, seeded) => {
        try {
          await roleRepository(tx).setClientScopeRoles(seeded.clientScopeId, []);
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      // RLS scopes the DELETE to nothing under the foreign tenant context,
      // so the call itself does not throw — it just cannot see the row to
      // touch, the same way idsForClientScopes reads nothing above.
      expectBlocked: (result) => {
        expect(result).toBe('succeeded');
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await roleRepository(tx).idsForClientScopes([seeded.clientScopeId]);
        expect(found).toEqual(new Set([seeded.roleId]));
      },
    });
  });
});
