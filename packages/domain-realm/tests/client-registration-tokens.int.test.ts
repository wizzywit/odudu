import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
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

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

async function newRealm(): Promise<string> {
  const realmId = newId();
  await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
  return realmId;
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
    const realmId = await newRealm();
    const { token } = await withRealm(app.db, realmId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ realmId, uses: 2, ttlSeconds: 3600 }),
    );

    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await withRealm(app.db, realmId, (tx) =>
          clientRegistrationTokenRepository(tx).spend(realmId, token),
        ),
      );
    }

    expect(results).toEqual([true, true, false]);
  });

  it('refuses an expired token', async () => {
    const realmId = await newRealm();
    const { token } = await withRealm(app.db, realmId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ realmId, uses: 1, ttlSeconds: 1 }),
    );
    await backdateExpiry(hashOf(token), new Date(Date.now() - 1000));

    const spent = await withRealm(app.db, realmId, (tx) =>
      clientRegistrationTokenRepository(tx).spend(realmId, token),
    );

    expect(spent).toBe(false);
  });

  it('refuses a token minted in another realm', async () => {
    const realmA = await newRealm();
    const realmB = await newRealm();
    const { token } = await withRealm(app.db, realmA, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ realmId: realmA, uses: 1, ttlSeconds: 3600 }),
    );

    const spent = await withRealm(app.db, realmB, (tx) =>
      clientRegistrationTokenRepository(tx).spend(realmB, token),
    );

    expect(spent).toBe(false);
  });

  it('does not let two concurrent spends overdraw a one-use token', async () => {
    const realmId = await newRealm();
    const { token } = await withRealm(app.db, realmId, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ realmId, uses: 1, ttlSeconds: 3600 }),
    );

    const [first, second] = await Promise.all([
      withRealm(app.db, realmId, (tx) =>
        clientRegistrationTokenRepository(tx).spend(realmId, token),
      ),
      withRealm(app.db, realmId, (tx) =>
        clientRegistrationTokenRepository(tx).spend(realmId, token),
      ),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
  });

  // `attempt` calls `spend` with the token's real realmId — the value an
  // honest caller would supply — while the connection itself is bound to
  // realm B. That is what makes this probe worth more than
  // `allForRealm`'s: if isolation depended on the application's own
  // eq(realmId, …) predicate rather than on the row-level security policy
  // applied to the UPDATE, this call would still match it and the probe
  // would pass for the wrong reason.
  it('does not spend a token minted in another realm, even given that token’s own realmId', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const { token } = await clientRegistrationTokenRepository(tx).mint({
          realmId,
          uses: 1,
          ttlSeconds: 3600,
        });
        return { realmId, token };
      },
      verifySeeded: async (tx, seeded) => {
        const spent = await clientRegistrationTokenRepository(tx).spend(
          seeded.realmId,
          seeded.token,
        );
        expect(spent).toBe(true);
      },
      attempt: async (tx, seeded) =>
        clientRegistrationTokenRepository(tx).spend(seeded.realmId, seeded.token),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });
});

describe('mint', () => {
  // `mint` itself only writes; what a probe of it can show is that the row
  // it wrote is invisible from another realm's context, the ordinary
  // row-filtering property `expectRealmIsolation` would cover directly if
  // this table were keyed simply — checked here through a raw select
  // instead, since the repository exposes no read of its own to attempt.
  it('does not expose a minted token to another realm', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const { token } = await clientRegistrationTokenRepository(tx).mint({
          realmId,
          uses: 1,
          ttlSeconds: 3600,
        });
        return { realmId, token };
      },
      verifySeeded: async (tx, seeded) => {
        const spent = await clientRegistrationTokenRepository(tx).spend(
          seeded.realmId,
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
