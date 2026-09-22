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
): Promise<void> {
  await tx.insert(signingKeys).values({
    id: newId(),
    tenantId,
    kid: newId(),
    alg: 'RS256',
    status: 'active',
    publicJwk: PUBLIC_JWK,
    privateJwkEncrypted: PRIVATE_ENCRYPTED,
    ...overrides,
  });
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
