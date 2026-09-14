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
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actionTokenRepository, type IssueActionToken } from '#/repository/action-tokens';
import { actionTokens, type ActionTokenType } from '#/schema/action-tokens';

function sha256HexForTest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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

// @odudu/account never imports @odudu/domain-identity, so a subject fixture
// is inserted with raw SQL rather than through that package's repository —
// the same idiom packages/domain-authz/tests/roles.int.test.ts uses.
async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

async function insertSubject(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into subjects (id, realm_id, type) values (${id}, ${realmId}, 'user')
  `);
  return id;
}

// Scoped to the current test's own realm, so a row another test issued (and
// never deleted, per ADR 0021) does not leak into this test's count.
async function rawSelectAllActionTokens() {
  return withRealm(app.db, realmId, (tx) =>
    tx
      .select({ tokenHash: actionTokens.tokenHash, consumedAt: actionTokens.consumedAt })
      .from(actionTokens),
  );
}

// Arbitrary but realistic; these tests probe issue/consume mechanics,
// not any particular token type's exposure window.
const TEST_TTL_SECONDS = 60 * 60;

let realmId: string;
let subject: string;

beforeEach(async () => {
  realmId = newId();
  subject = await withRealm(app.db, realmId, async (tx) => {
    await seedRealm(tx, realmId);
    return insertSubject(tx, realmId);
  });
});

async function issue(input: Omit<IssueActionToken, 'realmId'>): Promise<{ token: string }> {
  return withRealm(app.db, realmId, (tx) => actionTokenRepository(tx).issue({ realmId, ...input }));
}

async function consume(token: string, type: ActionTokenType) {
  return withRealm(app.db, realmId, (tx) => actionTokenRepository(tx).consume(token, type));
}

describe('issue and consume', () => {
  it('returns the subject for a fresh token', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      email: 'ada@example.test',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    await expect(consume(token, 'verify_email')).resolves.toMatchObject({ subjectId: subject });
  });

  it('stores no plaintext token', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    const rows = await rawSelectAllActionTokens();
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows.map((r) => r.tokenHash)).not.toContain(token);
  });

  it('refuses a second redemption', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    await consume(token, 'verify_email');
    await expect(consume(token, 'verify_email')).resolves.toBeNull();
  });

  it('refuses an expired token', async () => {
    const { token } = await issue({ subjectId: subject, type: 'verify_email', ttlSeconds: -1 });
    await expect(consume(token, 'verify_email')).resolves.toBeNull();
  });

  it('refuses a reset token presented as a verification token', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    await expect(consume(token, 'verify_email')).resolves.toBeNull();
  });

  it('keeps the consumed row, because nothing is deleted', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    await consume(token, 'verify_email');
    const rows = await rawSelectAllActionTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.consumedAt).not.toBeNull();
  });

  it('lets exactly one of two concurrent redemptions win', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    const results = await Promise.all([
      consume(token, 'verify_email'),
      consume(token, 'verify_email'),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('records the email the token was minted for', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'verify_email',
      email: 'ada@example.test',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    await expect(consume(token, 'verify_email')).resolves.toMatchObject({
      email: 'ada@example.test',
    });
  });
});

describe('peek', () => {
  it('reports a fresh token without consuming it', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'reset_password',
      email: 'ada@example.test',
      ttlSeconds: TEST_TTL_SECONDS,
    });

    const peeked = await withRealm(app.db, realmId, (tx) => actionTokenRepository(tx).peek(token));
    expect(peeked).toMatchObject({ subjectId: subject, type: 'reset_password' });

    // Still redeemable: peek must not have consumed it.
    await expect(consume(token, 'reset_password')).resolves.toMatchObject({ subjectId: subject });
  });

  it('reports nothing for a consumed token', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    await consume(token, 'reset_password');

    const peeked = await withRealm(app.db, realmId, (tx) => actionTokenRepository(tx).peek(token));
    expect(peeked).toBeNull();
  });

  it('reports nothing for an expired token', async () => {
    const { token } = await issue({ subjectId: subject, type: 'reset_password', ttlSeconds: -1 });

    const peeked = await withRealm(app.db, realmId, (tx) => actionTokenRepository(tx).peek(token));
    expect(peeked).toBeNull();
  });

  it('cannot see a token minted in another realm', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seedRealmId) => {
        await seedRealm(tx, seedRealmId);
        const seededSubject = await insertSubject(tx, seedRealmId);
        const { token } = await actionTokenRepository(tx).issue({
          realmId: seedRealmId,
          subjectId: seededSubject,
          type: 'reset_password',
          ttlSeconds: TEST_TTL_SECONDS,
        });
        return { token, subjectId: seededSubject };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await actionTokenRepository(tx).peek(seeded.token);
        expect(found).toMatchObject({ subjectId: seeded.subjectId });
      },
      attempt: async (tx, seeded) => actionTokenRepository(tx).peek(seeded.token),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const found = await actionTokenRepository(tx).peek(seeded.token);
        expect(found).toMatchObject({ subjectId: seeded.subjectId });
      },
    });
  });
});

describe('invalidateOutstanding', () => {
  it('consumes every outstanding token of the given type for the subject, and no other', async () => {
    const { token: first } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    const { token: second } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    // A different type for the same subject, and a verify_email token must
    // survive: this is reset-password's own cleanup, not a blanket wipe.
    const { token: verifyToken } = await issue({
      subjectId: subject,
      type: 'verify_email',
      ttlSeconds: TEST_TTL_SECONDS,
    });

    await withRealm(app.db, realmId, (tx) =>
      actionTokenRepository(tx).invalidateOutstanding(subject, 'reset_password'),
    );

    await expect(consume(first, 'reset_password')).resolves.toBeNull();
    await expect(consume(second, 'reset_password')).resolves.toBeNull();
    await expect(consume(verifyToken, 'verify_email')).resolves.toMatchObject({
      subjectId: subject,
    });
  });

  it('leaves an already-consumed token consumed, not double-touched', async () => {
    const { token } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    const consumedAt = (await consume(token, 'reset_password'))?.consumedAt;
    if (consumedAt === undefined) throw new Error('token was not consumed');

    await withRealm(app.db, realmId, (tx) =>
      actionTokenRepository(tx).invalidateOutstanding(subject, 'reset_password'),
    );

    const rows = await rawSelectAllActionTokens();
    const row = rows.find((r) => r.tokenHash === sha256HexForTest(token));
    expect(row?.consumedAt).toEqual(consumedAt);
  });

  it('does not touch another subject in the same realm', async () => {
    const otherSubject = await withRealm(app.db, realmId, (tx) => insertSubject(tx, realmId));
    const { token: mineToken } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    const { token: theirsToken } = await withRealm(app.db, realmId, (tx) =>
      actionTokenRepository(tx).issue({
        realmId,
        subjectId: otherSubject,
        type: 'reset_password',
        ttlSeconds: TEST_TTL_SECONDS,
      }),
    );

    await withRealm(app.db, realmId, (tx) =>
      actionTokenRepository(tx).invalidateOutstanding(subject, 'reset_password'),
    );

    await expect(consume(mineToken, 'reset_password')).resolves.toBeNull();
    await expect(consume(theirsToken, 'reset_password')).resolves.toMatchObject({
      subjectId: otherSubject,
    });
  });

  it("cannot invalidate another realm's outstanding tokens", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seedRealmId) => {
        await seedRealm(tx, seedRealmId);
        const seededSubject = await insertSubject(tx, seedRealmId);
        const { token } = await actionTokenRepository(tx).issue({
          realmId: seedRealmId,
          subjectId: seededSubject,
          type: 'reset_password',
          ttlSeconds: TEST_TTL_SECONDS,
        });
        return { token, subjectId: seededSubject };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await actionTokenRepository(tx).peek(seeded.token);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, seeded) =>
        actionTokenRepository(tx).invalidateOutstanding(seeded.subjectId, 'reset_password'),
      expectBlocked: () => {
        // invalidateOutstanding returns void; the assertion that matters is
        // verifyRealmAUnaffected below — an UPDATE an RLS policy narrows to
        // zero rows still "succeeds" with nothing touched.
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const found = await actionTokenRepository(tx).peek(seeded.token);
        expect(found).not.toBeNull();
      },
    });
  });
});

describe('realm isolation', () => {
  it('cannot consume a token minted in another realm, and leaves it unconsumed', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seedRealmId) => {
        await seedRealm(tx, seedRealmId);
        const seededSubject = await insertSubject(tx, seedRealmId);
        const { token } = await actionTokenRepository(tx).issue({
          realmId: seedRealmId,
          subjectId: seededSubject,
          type: 'verify_email',
          ttlSeconds: TEST_TTL_SECONDS,
        });
        return token;
      },
      verifySeeded: async (tx, token) => {
        const rows = await tx
          .select({ consumedAt: actionTokens.consumedAt })
          .from(actionTokens)
          .where(eq(actionTokens.tokenHash, sha256HexForTest(token)));
        expect(rows[0]?.consumedAt).toBeNull();
      },
      attempt: async (tx, token) => actionTokenRepository(tx).consume(token, 'verify_email'),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyRealmAUnaffected: async (tx, token) => {
        const rows = await tx
          .select({ consumedAt: actionTokens.consumedAt })
          .from(actionTokens)
          .where(eq(actionTokens.tokenHash, sha256HexForTest(token)));
        expect(rows[0]?.consumedAt).toBeNull();
      },
    });
  });
});
