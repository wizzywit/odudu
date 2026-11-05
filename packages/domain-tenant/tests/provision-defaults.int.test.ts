import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { CLIENT_SCOPE_LIMIT, SCOPE_LIMIT } from '@odudu/contracts/admin';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientScopeRepository } from '#/repository/client-scopes';
import {
  clientScopeAssignments,
  clientScopes,
  type ClientScopeAssignment,
} from '#/schema/client-scopes';
import { clients } from '#/schema/clients';
import {
  missingBuiltinScopeNames,
  provisionClientDefaults,
  provisionTenantDefaults,
  restoreBuiltinScopes,
  TENANT_DEFAULT_SCOPE_NAMES,
} from '#/usecase/provision-defaults';

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

describe('a newly provisioned client', () => {
  // `offline_access` reaching a token is asserted end to end in
  // packages/protocol-oidc/tests/offline-access.int.test.ts. What matters
  // here — and what nothing else pins — is the assignment *kind* each
  // default scope lands with: P3's consent screen reads that column to
  // tell a pre-approved scope from one it must ask about, so a future
  // change to provisionClientDefaults that quietly assigned everything
  // 'default' again would otherwise pass every existing test silently.
  it("assigns offline_access as 'optional' and every other default scope as 'default'", async () => {
    const tenantId = newId();
    const clientDbId = newId();

    const assignmentByName = await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      // Not provisionTenant: domain-tenant sits underneath authn-flows in the
      // dependency graph (authn-flows depends on it, never the reverse), so
      // a test in this package cannot reach the combined entry point. This
      // tenant intentionally has no flow — only the scope vocabulary this
      // test is about.
      await provisionTenantDefaults(tx, tenantId);
      await tx.insert(clients).values({
        id: clientDbId,
        tenantId,
        clientId: `client-${tenantId}`,
        name: 'a freshly provisioned client',
        type: 'public',
        secretHash: null,
      });
      await provisionClientDefaults(tx, clientDbId);

      const rows = await tx
        .select({ name: clientScopes.name, assignment: clientScopeAssignments.assignment })
        .from(clientScopeAssignments)
        .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
        .where(eq(clientScopeAssignments.clientId, clientDbId));
      return new Map<string, ClientScopeAssignment>(rows.map((row) => [row.name, row.assignment]));
    });

    // The MCP scopes are defined in every tenant but assigned to no client:
    // a client is given them deliberately.
    const assignedByDefault = TENANT_DEFAULT_SCOPE_NAMES.filter(
      (name) => name !== 'mcp:read' && name !== 'mcp:write',
    );
    expect([...assignmentByName.keys()].sort()).toEqual([...assignedByDefault].sort());
    expect(assignmentByName.get('offline_access')).toBe('optional');
    for (const name of assignedByDefault) {
      if (name === 'offline_access') continue;
      expect(assignmentByName.get(name), `${name} should be assigned 'default'`).toBe('default');
    }

    // An 'optional' assignment is still an assignment: the client can
    // request the scope and receive it (protocol-oidc's offline-access
    // tests prove that end to end; this is `forClient`'s own read, the
    // thing `resolveScope` intersects the request against).
    const assigned = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).forClient(clientDbId),
    );
    expect(assigned.map((scope) => scope.name)).toContain('offline_access');
  });
});

describe('the MCP scopes of a provisioned tenant', () => {
  it('exist with a description and are marked for no client', async () => {
    const tenantId = newId();
    const rows = await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionTenantDefaults(tx, tenantId);
      return clientScopeRepository(tx).byNames(['mcp:read', 'mcp:write']);
    });
    expect(rows.map((row) => row.name).sort()).toEqual(['mcp:read', 'mcp:write']);
    for (const row of rows) {
      expect(row.defaultClientAssignment).toBeNull();
      expect(row.includeInIdToken).toBe(false);
      expect(row.includeInAccessToken).toBe(true);
      expect(row.description).toMatch(/\S/u);
    }
  });

  it('are listed with the built-ins, so a restore recreates them', async () => {
    expect(TENANT_DEFAULT_SCOPE_NAMES).toEqual(expect.arrayContaining(['mcp:read', 'mcp:write']));
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionTenantDefaults(tx, tenantId);
      const repository = clientScopeRepository(tx);
      for (const row of await repository.byNames(['mcp:read', 'mcp:write'])) {
        await repository.delete(row.id);
      }
    });
    const outcome = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(outcome).toEqual({ kind: 'restored', created: ['mcp:read', 'mcp:write'] });
    const again = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).byNames(['mcp:read', 'mcp:write']),
    );
    expect(again.every((row) => row.defaultClientAssignment === null)).toBe(true);
  });

  it('are restored even when the scopes marked for new clients are at their ceiling', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionTenantDefaults(tx, tenantId);
      const repository = clientScopeRepository(tx);
      for (const row of await repository.byNames(['mcp:read', 'mcp:write'])) {
        await repository.delete(row.id);
      }
      const held = await repository.countDefaultsUpTo(tenantId, CLIENT_SCOPE_LIMIT);
      await tx.insert(clientScopes).values(
        Array.from({ length: CLIENT_SCOPE_LIMIT - held }, (_, index) => ({
          id: newId(),
          tenantId,
          name: `marked-${String(index)}`,
          defaultClientAssignment: 'optional' as const,
        })),
      );
    });
    const outcome = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(outcome).toEqual({ kind: 'restored', created: ['mcp:read', 'mcp:write'] });
  });
});

describe('restoring the built-in scopes', () => {
  async function provisionedTenant(): Promise<string> {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionTenantDefaults(tx, tenantId);
    });
    return tenantId;
  }

  async function settingsOf(tenantId: string) {
    return withTenant(app.db, tenantId, async (tx) => {
      const rows = await clientScopeRepository(tx).allForTenant();
      return rows
        .map((scope) => ({
          name: scope.name,
          description: scope.description,
          includeInIdToken: scope.includeInIdToken,
          includeInAccessToken: scope.includeInAccessToken,
          defaultClientAssignment: scope.defaultClientAssignment,
          consentText: scope.consentText,
          displayOrder: scope.displayOrder,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  it('recreates every missing built-in with the settings provisioning gave it, and only then', async () => {
    const pristine = await settingsOf(await provisionedTenant());
    const tenantId = await provisionedTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = clientScopeRepository(tx);
      for (const name of TENANT_DEFAULT_SCOPE_NAMES) {
        const scope = await repository.byName(name);
        if (scope !== null) await repository.delete(scope.id);
      }
    });

    const first = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(first).toEqual({ kind: 'restored', created: [...TENANT_DEFAULT_SCOPE_NAMES] });
    expect(await settingsOf(tenantId)).toEqual(pristine);

    const second = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(second).toEqual({ kind: 'restored', created: [] });
  });

  it('leaves a built-in that exists exactly as an administrator edited it', async () => {
    const tenantId = await provisionedTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = clientScopeRepository(tx);
      const profile = await repository.byName('profile');
      if (profile === null) throw new Error('profile was not provisioned');
      await repository.amend(profile.id, {
        description: 'edited',
        includeInAccessToken: true,
        defaultClientAssignment: null,
      });
      const roles = await repository.byName('roles');
      if (roles === null) throw new Error('roles was not provisioned');
      await repository.delete(roles.id);
    });

    const outcome = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(outcome).toEqual({ kind: 'restored', created: ['roles'] });
    const profile = await withTenant(app.db, tenantId, (tx) =>
      clientScopeRepository(tx).byName('profile'),
    );
    expect(profile).toMatchObject({
      description: 'edited',
      includeInAccessToken: true,
      defaultClientAssignment: null,
    });
  });

  it('names the missing built-ins without creating them', async () => {
    const tenantId = await provisionedTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = clientScopeRepository(tx);
      const groups = await repository.byName('groups');
      if (groups === null) throw new Error('groups was not provisioned');
      await repository.delete(groups.id);
    });
    const missing = await withTenant(app.db, tenantId, (tx) => missingBuiltinScopeNames(tx));
    expect(missing).toEqual(['groups']);
    const again = await withTenant(app.db, tenantId, (tx) => missingBuiltinScopeNames(tx));
    expect(again).toEqual(['groups']);
  });

  it('does not touch another tenant, and reads only its own scopes', async () => {
    const mine = await provisionedTenant();
    const other = await provisionedTenant();
    await withTenant(app.db, other, async (tx) => {
      const repository = clientScopeRepository(tx);
      const email = await repository.byName('email');
      if (email === null) throw new Error('email was not provisioned');
      await repository.delete(email.id);
    });
    const outcome = await withTenant(app.db, mine, (tx) => restoreBuiltinScopes(tx, mine));
    expect(outcome).toEqual({ kind: 'restored', created: [] });
    expect(await withTenant(app.db, other, (tx) => missingBuiltinScopeNames(tx))).toEqual([
      'email',
    ]);
  });

  it('refuses, creating nothing, when the missing ones would pass the tenant scope limit', async () => {
    const tenantId = await provisionedTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = clientScopeRepository(tx);
      const roles = await repository.byName('roles');
      if (roles === null) throw new Error('roles was not provisioned');
      await repository.delete(roles.id);
      const held = await repository.countUpTo(SCOPE_LIMIT);
      await tx.insert(clientScopes).values(
        Array.from({ length: SCOPE_LIMIT - held }, (_, index) => ({
          id: newId(),
          tenantId,
          name: `filler-${String(index)}`,
        })),
      );
    });
    const outcome = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(outcome).toEqual({ kind: 'scope_limit' });
    expect(await withTenant(app.db, tenantId, (tx) => missingBuiltinScopeNames(tx))).toEqual([
      'roles',
    ]);
  });
});

describe('restoring when too many scopes are marked for new clients', () => {
  it('refuses with the default-scope message and creates none of the missing ones', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionTenantDefaults(tx, tenantId);
      const repository = clientScopeRepository(tx);
      for (const name of ['roles', 'groups']) {
        const scope = await repository.byName(name);
        if (scope !== null) await repository.delete(scope.id);
      }
      const held = await repository.countDefaultsUpTo(tenantId, CLIENT_SCOPE_LIMIT);
      await tx.insert(clientScopes).values(
        Array.from({ length: CLIENT_SCOPE_LIMIT - held - 1 }, (_, index) => ({
          id: newId(),
          tenantId,
          name: `marked-${String(index)}`,
          defaultClientAssignment: 'optional' as const,
        })),
      );
    });
    const outcome = await withTenant(app.db, tenantId, (tx) => restoreBuiltinScopes(tx, tenantId));
    expect(outcome.kind).toBe('default_scope_limit');
    expect(await withTenant(app.db, tenantId, (tx) => missingBuiltinScopeNames(tx))).toEqual([
      'roles',
      'groups',
    ]);
  });
});
