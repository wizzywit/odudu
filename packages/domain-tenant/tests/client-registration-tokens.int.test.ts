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
  // instead of `list()` (probed on its own below), so this one keeps
  // working even if `list()`'s own filtering ever changed.
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

describe('list', () => {
  it('lists a live token, never its hash', async () => {
    const tenantId = await newTenant();
    const { id } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 3, ttlSeconds: 3600 }),
    );

    const items = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).list(),
    );

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.id).toBe(id);
    expect(item?.remainingUses).toBe(3);
    expect(item).not.toHaveProperty('tokenHash');
  });

  it('never lists a spent-out token', async () => {
    const tenantId = await newTenant();
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 3600 }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).spend(tenantId, token),
    );

    const items = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).list(),
    );

    expect(items).toEqual([]);
  });

  it('never lists an expired token', async () => {
    const tenantId = await newTenant();
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 3600 }),
    );
    await backdateExpiry(hashOf(token), new Date(Date.now() - 1000));

    const items = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).list(),
    );

    expect(items).toEqual([]);
  });

  it('never lists a token minted in another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        await clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 3600 });
        return { tenantId };
      },
      verifySeeded: async (tx) => {
        const items = await clientRegistrationTokenRepository(tx).list();
        expect(items).toHaveLength(1);
      },
      attempt: async (tx) => clientRegistrationTokenRepository(tx).list(),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});

describe('revoke', () => {
  it('revokes a token, after which it can no longer be spent', async () => {
    const tenantId = await newTenant();
    const { id, token } = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId, uses: 1, ttlSeconds: 3600 }),
    );

    const revoked = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).revoke(id),
    );
    expect(revoked).toBe(true);

    const spent = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).spend(tenantId, token),
    );
    expect(spent).toBe(false);
  });

  it('answers false for an id that names no token', async () => {
    const tenantId = await newTenant();

    const revoked = await withTenant(app.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).revoke(newId()),
    );

    expect(revoked).toBe(false);
  });

  it('does not revoke a token minted in another tenant, even given that token’s own id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const { id } = await clientRegistrationTokenRepository(tx).mint({
          tenantId,
          uses: 1,
          ttlSeconds: 3600,
        });
        return { tenantId, id };
      },
      verifySeeded: async (tx, seeded) => {
        const items = await clientRegistrationTokenRepository(tx).list();
        expect(items.map((item) => item.id)).toContain(seeded.id);
      },
      attempt: async (tx, seeded) => clientRegistrationTokenRepository(tx).revoke(seeded.id),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });
});
