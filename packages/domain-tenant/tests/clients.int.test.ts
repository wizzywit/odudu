import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientRepository } from '#/repository/clients';
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

async function insertClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  overrides: Partial<typeof clients.$inferInsert> = {},
): Promise<void> {
  await tx.insert(clients).values({
    id: newId(),
    tenantId,
    clientId: `client-${newId()}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
    ...overrides,
  });
}

describe('clientRepository', () => {
  it('finds a client by its client_id', async () => {
    const tenantId = newId();
    const clientId = `web-app-${newId()}`;

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await insertClient(tx, tenantId, { clientId });
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      clientRepository(tx).byClientId(clientId),
    );

    expect(found).not.toBeNull();
    expect(found?.clientId).toBe(clientId);
    expect(found?.type).toBe('confidential');
  });

  it('returns null when no client matches', async () => {
    const tenantId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      clientRepository(tx).byClientId('does-not-exist'),
    );

    expect(found).toBeNull();
  });

  it('creates a client through the repository', async () => {
    const tenantId = newId();
    const clientId = `created-${newId()}`;

    const created = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return clientRepository(tx).create({
        tenantId,
        clientId,
        name: 'Created client',
        type: 'public',
        secretHash: null,
      });
    });

    expect(created.clientId).toBe(clientId);
    expect(created.type).toBe('public');
    expect(created.secretHash).toBeNull();
    expect(created.id).not.toBe('');

    const found = await withTenant(app.db, tenantId, async (tx) =>
      clientRepository(tx).byClientId(clientId),
    );
    expect(found?.id).toBe(created.id);
  });

  it('rejects a second client with the same client_id in one tenant', async () => {
    const tenantId = newId();
    const clientId = `dup-${newId()}`;

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        await insertClient(tx, tenantId, { clientId });
        await insertClient(tx, tenantId, { clientId });
      });
      expect.unreachable('expected the duplicate client_id insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('clients_client_id_unique');
  });

  it('rejects a public client carrying a secret', async () => {
    const tenantId = newId();

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        await insertClient(tx, tenantId, { type: 'public', secretHash: 'x' });
      });
      expect.unreachable('expected the public client with a secret to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('clients_secret_matches_type');
  });

  it('isolates clients by tenant', async () => {
    await expectTenantIsolation(app.db, {
      table: 'clients',
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertClient(tx, tenantId);
      },
    });
  });

  it('leaves an existing tenant and an existing client unchanged in behaviour', async () => {
    const tenantId = newId();

    const created = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return clientRepository(tx).create({
        tenantId,
        clientId: `seeded-${newId()}`,
        name: 'A seeded client',
        type: 'public',
        secretHash: null,
      });
    });

    expect(created.registrationOrigin).toBe('seeded');

    const [tenant] = await withTenant(app.db, tenantId, async (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, tenantId)),
    );
    expect(tenant?.clientRegistrationPolicy).toBe('disabled');
    expect(tenant?.maxClients).toBe(200);
  });

  it('cannot find a client by client_id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientId = `probe-${newId()}`;
        await insertClient(tx, tenantId, { clientId });
        return clientId;
      },
      verifySeeded: async (tx, clientId) => {
        const found = await clientRepository(tx).byClientId(clientId);
        expect(found).not.toBeNull();
        expect(found?.clientId).toBe(clientId);
      },
      attempt: async (tx, clientId) => clientRepository(tx).byClientId(clientId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('locks and counts capacity for the resolved tenant, not the caller-supplied id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertClient(tx, tenantId);
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        const capacity = await clientRepository(tx).lockCapacity(tenantId);
        expect(capacity.count).toBe(1);
        expect(capacity.maxClients).toBe(200);
      },
      // Tenant B's RLS-scoped read of `tenants` finds no row for tenant A's
      // id, so the lock itself is what refuses — not a count that quietly
      // comes back as someone else's tenant's number.
      attempt: async (tx, tenantId) => {
        try {
          return await clientRepository(tx).lockCapacity(tenantId);
        } catch (error) {
          return { threw: true, message: error instanceof Error ? error.message : String(error) };
        }
      },
      expectBlocked: (result) => {
        expect(result).toMatchObject({ threw: true });
      },
    });
  });

  it('cannot amend a client under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientId = `amend-probe-${newId()}`;
        await insertClient(tx, tenantId, { clientId });
        const found = await clientRepository(tx).byClientId(clientId);
        if (found === null) throw new Error('fixture: inserted client not found');
        return found.id;
      },
      verifySeeded: async (tx, clientDbId) => {
        const updated = await clientRepository(tx).update(clientDbId, { name: 'Renamed' });
        expect(updated.name).toBe('Renamed');
      },
      attempt: async (tx, clientDbId) => {
        try {
          return await clientRepository(tx).update(clientDbId, { name: 'Evaded' });
        } catch (error) {
          return { threw: true, message: error instanceof Error ? error.message : String(error) };
        }
      },
      expectBlocked: (result) => {
        expect(result).toMatchObject({ threw: true });
      },
    });
  });

  it('cannot rotate a client secret under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientId = `secret-probe-${newId()}`;
        await insertClient(tx, tenantId, { clientId });
        const found = await clientRepository(tx).byClientId(clientId);
        if (found === null) throw new Error('fixture: inserted client not found');
        return found.id;
      },
      verifySeeded: async (tx, clientDbId) => {
        const rotated = await clientRepository(tx).rotateSecret(clientDbId, 'hashed:new');
        expect(rotated.secretHash).toBe('hashed:new');
      },
      attempt: async (tx, clientDbId) => {
        try {
          return await clientRepository(tx).rotateSecret(clientDbId, 'hashed:evaded');
        } catch (error) {
          return { threw: true, message: error instanceof Error ? error.message : String(error) };
        }
      },
      expectBlocked: (result) => {
        expect(result).toMatchObject({ threw: true });
      },
    });
  });

  it('cannot delete a client under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientId = `delete-probe-${newId()}`;
        await insertClient(tx, tenantId, { clientId });
        const found = await clientRepository(tx).byClientId(clientId);
        if (found === null) throw new Error('fixture: inserted client not found');
        return found.id;
      },
      verifySeeded: async (tx, clientDbId) => {
        const found = await clientRepository(tx).byId(clientDbId);
        expect(found).not.toBeNull();
      },
      // `delete` is a no-op DELETE-with-no-match under a foreign tenant's
      // RLS scope, not a throw — so the block is verified by the row
      // surviving, in tenant A's own context, rather than by an exception.
      attempt: async (tx, clientDbId) => {
        await clientRepository(tx).delete(clientDbId);
        return clientDbId;
      },
      // `delete` under a foreign tenant resolves without throwing (an
      // unmatched DELETE is not an error) — `verifyTenantAUnaffected`
      // below is what actually proves the row was not touched.
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, clientDbId) => {
        const survived = await clientRepository(tx).byId(clientDbId);
        expect(survived).not.toBeNull();
      },
    });
  });
});
