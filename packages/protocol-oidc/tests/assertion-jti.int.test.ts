import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertionJtiRepository } from '#/repository/assertion-jti';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const expiresAt = new Date(NOW.getTime() + 60_000);
const past = new Date(NOW.getTime() - 60_000);

let realmId: string;

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

async function seedRealm(tx: RealmScopedDatabase, id: string): Promise<void> {
  await tx.insert(realms).values({ id, name: `realm-${id}` });
}

beforeEach(async () => {
  realmId = newId();
  await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
});

describe('assertionJtiRepository', () => {
  it('admits a jti the first time', async () => {
    const result = await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );
    expect(result).toBe(true);
  });

  it('refuses the same jti from the same client', async () => {
    await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );
    const replay = await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );
    expect(replay).toBe(false);
  });

  // The boundary that makes the unique constraint composite: a jti is
  // unique per issuer, and two clients may pick the same one. Satisfied
  // only by the client dimension of the key — the realm is the same
  // realmId both calls run under — so this is the one test that would
  // still pass if the primary key dropped oauth_client_id entirely.
  it('admits the same jti from a different client', async () => {
    await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );
    const other = await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-b', 'jti-1', expiresAt),
    );
    expect(other).toBe(true);
  });

  // Satisfied only by the realm dimension of the key — client and jti are
  // identical across both calls, only realmId differs — the complement of
  // the client-dimension test above.
  it('cannot see a jti claimed in another realm', async () => {
    await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );

    const otherRealmId = newId();
    await withRealm(app.db, otherRealmId, (tx) => seedRealm(tx, otherRealmId));

    const admitted = await withRealm(app.db, otherRealmId, (tx) =>
      assertionJtiRepository(tx).claim(otherRealmId, 'client-a', 'jti-1', expiresAt),
    );
    expect(admitted).toBe(true);
  });

  // The non-negotiable every repository method is held to: a realm_id that
  // disagrees with the transaction's own realm context is refused, by the
  // same USING/WITH CHECK predicate any other cross-realm write hits
  // (0054_client_assertion_jti.sql) — postgres.js rejects the whole
  // transaction on the policy violation, so this asserts the rejection
  // directly, the way codes.int.test.ts's own cross-realm create probe does.
  it('refuses to claim a jti under a foreign realm_id', async () => {
    const foreignRealmId = newId();
    await withRealm(app.db, foreignRealmId, (tx) => seedRealm(tx, foreignRealmId));

    await expect(
      withRealm(app.db, realmId, (tx) =>
        assertionJtiRepository(tx).claim(foreignRealmId, 'client-a', 'jti-1', expiresAt),
      ),
    ).rejects.toThrow();
  });

  // The property this guard exists for: a claim made inside a request that
  // later fails for an unrelated reason must stay spent. `claim` is called
  // here the way `rotateRefreshToken`'s caller uses it (token-issuance.ts)
  // — in its own `withRealm` transaction, independent of the "request"
  // transaction enclosing it — and the request transaction then rolls
  // back. A test that only claimed twice in a row would not reach this: it
  // is the rollback, not the second claim, that would release a jti run
  // inside the request's own transaction.
  it('leaves a jti spent when the request that claimed it rolls back', async () => {
    await expect(
      withRealm(app.db, realmId, async () => {
        await withRealm(app.db, realmId, (claimTx) =>
          assertionJtiRepository(claimTx).claim(realmId, 'client-a', 'jti-1', expiresAt),
        );
        throw new Error('the request failed for an unrelated reason');
      }),
    ).rejects.toThrow('the request failed for an unrelated reason');

    const replay = await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );
    expect(replay).toBe(false);
  });

  // The converse of the property above, stated as its own test: an
  // assertion is single-use, so a request that claims a jti and then fails
  // for a reason that has nothing to do with the assertion still leaves
  // that jti spent for good — a client cannot retry the same assertion
  // after an unrelated failure. Cleanup of an expired claim is the
  // retention pass's job (apps/server/src/cli/reap.ts), not `claim`'s: a
  // row past its own expires_at is still exactly as good at refusing a
  // replay as a fresh one, until something reaps it.
  it('keeps refusing a replay of a jti already past its own expiry', async () => {
    await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', past),
    );
    const replay = await withRealm(app.db, realmId, (tx) =>
      assertionJtiRepository(tx).claim(realmId, 'client-a', 'jti-1', expiresAt),
    );
    expect(replay).toBe(false);
  });
});
