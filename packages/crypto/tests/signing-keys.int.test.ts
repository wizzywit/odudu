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
import { newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signingKeyRepository } from '#/repository/signing-keys';
import { signingKeys } from '#/schema/signing-keys';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const PUBLIC_JWK = { kty: 'RSA', n: 'n-value', e: 'AQAB' };
const PRIVATE_ENCRYPTED = 'ciphertext-placeholder';

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

async function insertKey(
  tx: TenantScopedDatabase,
  tenantId: string,
  overrides: Partial<typeof signingKeys.$inferInsert> = {},
): Promise<{ id: string }> {
  const id = overrides.id ?? newId();
  await tx.insert(signingKeys).values({
    tenantId,
    kid: newId(),
    alg: 'RS256',
    status: 'active',
    publicJwk: PUBLIC_JWK,
    privateJwkEncrypted: PRIVATE_ENCRYPTED,
    ...overrides,
    id,
  });
  return { id };
}

describe('signingKeyRepository', () => {
  it('round-trips a key through the repository', async () => {
    const tenantId = newId();
    const kid = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await insertKey(tx, tenantId, { kid });
    });

    const active = await withTenant(app.db, tenantId, async (tx) =>
      signingKeyRepository(tx).active(),
    );

    expect(active.kid).toBe(kid);
    expect(active.alg).toBe('RS256');
    expect(active.status).toBe('active');
    expect(active.publicJwk).toEqual(PUBLIC_JWK);
    expect(active.privateJwkEncrypted).toBe(PRIVATE_ENCRYPTED);
    expect(active.notAfter).toBeNull();
  });

  it('excludes retired keys from the published set', async () => {
    const tenantId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await insertKey(tx, tenantId, { kid: 'active-kid', status: 'active' });
      await insertKey(tx, tenantId, { kid: 'rotating-kid', status: 'rotating' });
      await insertKey(tx, tenantId, { kid: 'retired-kid', status: 'retired' });
    });

    const published = await withTenant(app.db, tenantId, async (tx) =>
      signingKeyRepository(tx).listPublishable(),
    );

    expect(published.map((k) => k.kid)).toEqual(['active-kid', 'rotating-kid']);
  });

  it('refuses a second active key in one tenant', async () => {
    const tenantId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await insertKey(tx, tenantId, { status: 'active' });
    });

    // Drizzle wraps the driver error as `DrizzleQueryError`, whose own
    // .message is just "Failed query: ...<sql>..." — the postgres error text
    // (and the constraint name) lives on .cause, which `toThrow` never
    // inspects.
    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) =>
        insertKey(tx, tenantId, { status: 'active' }),
      );
      expect.unreachable('expected the second active insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('signing_keys_one_active');
  });

  it('allows a second key when the first is not active', async () => {
    const tenantId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      await insertKey(tx, tenantId, { status: 'rotating' });
      await insertKey(tx, tenantId, { status: 'active' });
    });

    const active = await withTenant(app.db, tenantId, async (tx) =>
      signingKeyRepository(tx).active(),
    );
    expect(active.status).toBe('active');
  });

  it('isolates keys by tenant', async () => {
    await expectTenantIsolation(app.db, {
      table: 'signing_keys',
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertKey(tx, tenantId);
      },
    });
  });

  it('lists no publishable keys under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertKey(tx, tenantId);
      },
      verifySeeded: async (tx) => {
        const found = await signingKeyRepository(tx).listPublishable();
        expect(found.length).toBeGreaterThan(0);
      },
      attempt: async (tx) => signingKeyRepository(tx).listPublishable(),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('finds no active key under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertKey(tx, tenantId, { status: 'active' });
      },
      verifySeeded: async (tx) => {
        const found = await signingKeyRepository(tx).active();
        expect(found.status).toBe('active');
      },
      attempt: async (tx) => {
        try {
          return { key: await signingKeyRepository(tx).active() };
        } catch (error) {
          return { error };
        }
      },
      expectBlocked: (result) => {
        expect(result).toHaveProperty('error');
        expect((result as { error: unknown }).error).toBeInstanceOf(OduduError);
      },
    });
  });
});

describe('selecting a signing key', () => {
  it('prefers a non-retired key matching the algorithm asked for', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'active' }),
    );
    const rotating = await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'ES256', status: 'rotating' }),
    );

    const chosen = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).forAlg('ES256'),
    );
    expect(chosen?.id).toBe(rotating.id);
  });

  it('prefers active over rotating when both match the algorithm', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const active = await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'active' }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'rotating' }),
    );

    const chosen = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).forAlg('RS256'),
    );
    expect(chosen?.id).toBe(active.id);
  });

  it('never selects a retired key', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'ES256', status: 'retired' }),
    );

    const chosen = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).forAlg('ES256'),
    );
    expect(chosen).toBeNull();
  });

  it('reports every non-retired algorithm, so discovery can advertise them', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'active' }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'ES256', status: 'rotating' }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'ES256', status: 'retired' }),
    );

    const algs = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).algorithmsAvailable(),
    );
    expect([...algs].sort()).toEqual(['ES256', 'RS256']);
  });

  it('reports no algorithms for a tenant with no non-retired key', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));

    const algs = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).algorithmsAvailable(),
    );
    expect(algs).toEqual([]);
  });

  it('finds no key for an algorithm under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertKey(tx, tenantId, { alg: 'RS256', status: 'active' });
      },
      verifySeeded: async (tx) => {
        const found = await signingKeyRepository(tx).forAlg('RS256');
        expect(found?.alg).toBe('RS256');
      },
      attempt: async (tx) => signingKeyRepository(tx).forAlg('RS256'),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('reports no algorithms under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertKey(tx, tenantId, { alg: 'RS256', status: 'active' });
      },
      verifySeeded: async (tx) => {
        const found = await signingKeyRepository(tx).algorithmsAvailable();
        expect(found.length).toBeGreaterThan(0);
      },
      attempt: async (tx) => signingKeyRepository(tx).algorithmsAvailable(),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});

describe('promoting and retiring a signing key', () => {
  it('promotes a rotating key to active, demoting whatever was active', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const active = await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'ES256', status: 'active' }),
    );
    const rotating = await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'rotating' }),
    );

    const promoted = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).promote(rotating.id),
    );
    expect(promoted?.status).toBe('active');

    await withTenant(app.db, tenantId, async (tx) => {
      const rows = await tx.select().from(signingKeys);
      const byId = new Map(rows.map((row) => [row.id, row.status]));
      expect(byId.get(rotating.id)).toBe('active');
      expect(byId.get(active.id)).toBe('rotating');
    });
  });

  it('promotes nothing for a missing or already-retired key', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const retired = await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'retired' }),
    );

    expect(
      await withTenant(app.db, tenantId, (tx) => signingKeyRepository(tx).promote(newId())),
    ).toBeNull();
    expect(
      await withTenant(app.db, tenantId, (tx) => signingKeyRepository(tx).promote(retired.id)),
    ).toBeNull();
  });

  it('retires a key regardless of its current status', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const rotating = await withTenant(app.db, tenantId, (tx) =>
      insertKey(tx, tenantId, { alg: 'RS256', status: 'rotating' }),
    );

    const retired = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).retire(rotating.id),
    );
    expect(retired?.status).toBe('retired');
  });

  it('retires nothing for a missing key', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));

    expect(
      await withTenant(app.db, tenantId, (tx) => signingKeyRepository(tx).retire(newId())),
    ).toBeNull();
  });

  it('promotes nothing under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await insertKey(tx, tenantId, { alg: 'ES256', status: 'active' });
        const rotating = await insertKey(tx, tenantId, { alg: 'RS256', status: 'rotating' });
        return rotating.id;
      },
      verifySeeded: async (tx, keyId) => {
        const rows = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId));
        expect(rows).toHaveLength(1);
      },
      attempt: async (tx, keyId) => signingKeyRepository(tx).promote(keyId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, keyId) => {
        const [row] = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId));
        expect(row?.status).toBe('rotating');
      },
    });
  });

  it('retires nothing under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const rotating = await insertKey(tx, tenantId, { alg: 'RS256', status: 'rotating' });
        return rotating.id;
      },
      verifySeeded: async (tx, keyId) => {
        const rows = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId));
        expect(rows).toHaveLength(1);
      },
      attempt: async (tx, keyId) => signingKeyRepository(tx).retire(keyId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, keyId) => {
        const [row] = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId));
        expect(row?.status).toBe('rotating');
      },
    });
  });
});
