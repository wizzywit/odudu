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
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientRegistrationTokenRepository } from '#/repository/client-registration-tokens';
import { clientRegistrationTokens } from '#/schema/client-registration-tokens';

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

async function newTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  return tenantId;
}

// The clock a test controls cannot move the database's own `now()`, which
// is what `spend`'s expiry check runs against — so an expired fixture is
// produced by writing a past expires_at through the owner connection,
// rather than by injecting a fake clock into the repository.
async function backdateExpiry(tokenHash: string, expiresAt: Date): Promise<void> {
  await owner.db
    .update(clientRegistrationTokens)
    .set({ expiresAt })
    .where(eq(clientRegistrationTokens.tokenHash, tokenHash));
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('spend', () => {
  it('spends a token exactly as many times as it has uses', async () => {
    const tenantId = await newTenant();
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 2, ttlSeconds: 3600 }),
    );

    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await withTenant(app.db, tenantId, (tx) =>
          clientRegistrationTokenRepository(tx).spend(tenantId, token),
        ),
      );
    }

    expect(results).toEqual([true, true, false]);
  });

  it('refuses an expired token', async () => {
    const tenantId = await newTenant();
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 1 }),
    );
    await backdateExpiry(hashOf(token), new Date(Date.now() - 1000));

    const spent = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).spend(tenantId, token),
    );

    expect(spent).toBe(false);
  });

  it('refuses a token minted in another tenant', async () => {
    const tenantA = await newTenant();
    const tenantB = await newTenant();
    const { token } = await withTenant(app.db, tenantA, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId: tenantA, uses: 1, ttlSeconds: 3600 }),
    );

    const spent = await withTenant(app.db, tenantB, (tx) =>
      clientRegistrationTokenRepository(tx).spend(tenantB, token),
    );

    expect(spent).toBe(false);
  });

  it('does not let two concurrent spends overdraw a one-use token', async () => {
    const tenantId = await newTenant();
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 3600 }),
    );

    const [first, second] = await Promise.all([
      withTenant(app.db, tenantId, (tx) =>
        clientRegistrationTokenRepository(tx).spend(tenantId, token),
      ),
      withTenant(app.db, tenantId, (tx) =>
        clientRegistrationTokenRepository(tx).spend(tenantId, token),
      ),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
  });

  // `attempt` calls `spend` with the token's real tenantId — the value an
  // honest caller would supply — while the connection itself is bound to
  // tenant B. That is what makes this probe worth more than
  // `allForTenant`'s: if isolation depended on the application's own
  // eq(tenantId, …) predicate rather than on the row-level security policy
  // applied to the UPDATE, this call would still match it and the probe
  // would pass for the wrong reason.
  it('does not spend a token minted in another tenant, even given that token’s own tenantId', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const { token } = await clientRegistrationTokenRepository(tx).mint({
          tenantId,
          uses: 1,
          ttlSeconds: 3600,
        });
        return { tenantId, token };
      },
      verifySeeded: async (tx, seeded) => {
        const spent = await clientRegistrationTokenRepository(tx).spend(
          seeded.tenantId,
          seeded.token,
        );
        expect(spent).toBe(true);
      },
      attempt: async (tx, seeded) =>
        clientRegistrationTokenRepository(tx).spend(seeded.tenantId, seeded.token),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });
});

describe('mint', () => {
  // `mint` itself only writes; what a probe of it can show is that the row
  // it wrote is invisible from another tenant's context, the ordinary
  // row-filtering property `expectTenantIsolation` would cover directly if
  // this table were keyed simply — checked here through a raw select
  // instead, since the repository exposes no read of its own to attempt.
  it('does not expose a minted token to another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const { token } = await clientRegistrationTokenRepository(tx).mint({
          tenantId,
          uses: 1,
          ttlSeconds: 3600,
        });
        return { tenantId, token };
      },
      verifySeeded: async (tx, seeded) => {
        const spent = await clientRegistrationTokenRepository(tx).spend(
          seeded.tenantId,
          seeded.token,
        );
        expect(spent).toBe(true);
      },
      attempt: async (tx) =>
        tx.select({ id: clientRegistrationTokens.id }).from(clientRegistrationTokens),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});
