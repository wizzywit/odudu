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
async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function insertSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.execute(sql`
    insert into subjects (id, tenant_id, type) values (${id}, ${tenantId}, 'user')
  `);
  return id;
}

// Scoped to the current test's own tenant, so a row another test issued (and
// never deleted, per ADR 0021) does not leak into this test's count.
async function rawSelectAllActionTokens() {
  return withTenant(app.db, tenantId, (tx) =>
    tx
      .select({ tokenHash: actionTokens.tokenHash, consumedAt: actionTokens.consumedAt })
      .from(actionTokens),
  );
}

// Arbitrary but realistic; these tests probe issue/consume mechanics,
// not any particular token type's exposure window.
const TEST_TTL_SECONDS = 60 * 60;

let tenantId: string;
let subject: string;

beforeEach(async () => {
  tenantId = newId();
  subject = await withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId);
    return insertSubject(tx, tenantId);
  });
});

async function issue(input: Omit<IssueActionToken, 'tenantId'>): Promise<{ token: string }> {
  return withTenant(app.db, tenantId, (tx) =>
    actionTokenRepository(tx).issue({ tenantId, ...input }),
  );
}

async function consume(token: string, type: ActionTokenType) {
  return withTenant(app.db, tenantId, (tx) => actionTokenRepository(tx).consume(token, type));
}

// The driver only carries the fired policy's message on the query error's
// `.cause.message`, not on the top-level message `.rejects.toThrow` reads —
// see roles.int.test.ts's causeMessage in packages/domain-authz/tests.
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

    const peeked = await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).peek(token),
    );
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

    const peeked = await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).peek(token),
    );
    expect(peeked).toBeNull();
  });

  it('reports nothing for an expired token', async () => {
    const { token } = await issue({ subjectId: subject, type: 'reset_password', ttlSeconds: -1 });

    const peeked = await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).peek(token),
    );
    expect(peeked).toBeNull();
  });

  it('cannot see a token minted in another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seedTenantId) => {
        await seedTenant(tx, seedTenantId);
        const seededSubject = await insertSubject(tx, seedTenantId);
        const { token } = await actionTokenRepository(tx).issue({
          tenantId: seedTenantId,
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
      verifyTenantAUnaffected: async (tx, seeded) => {
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

    await withTenant(app.db, tenantId, (tx) =>
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

    await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).invalidateOutstanding(subject, 'reset_password'),
    );

    const rows = await rawSelectAllActionTokens();
    const row = rows.find((r) => r.tokenHash === sha256HexForTest(token));
    expect(row?.consumedAt).toEqual(consumedAt);
  });

  it('does not touch another subject in the same tenant', async () => {
    const otherSubject = await withTenant(app.db, tenantId, (tx) => insertSubject(tx, tenantId));
    const { token: mineToken } = await issue({
      subjectId: subject,
      type: 'reset_password',
      ttlSeconds: TEST_TTL_SECONDS,
    });
    const { token: theirsToken } = await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).issue({
        tenantId,
        subjectId: otherSubject,
        type: 'reset_password',
        ttlSeconds: TEST_TTL_SECONDS,
      }),
    );

    await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).invalidateOutstanding(subject, 'reset_password'),
    );

    await expect(consume(mineToken, 'reset_password')).resolves.toBeNull();
    await expect(consume(theirsToken, 'reset_password')).resolves.toMatchObject({
      subjectId: otherSubject,
    });
  });

  it("cannot invalidate another tenant's outstanding tokens", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seedTenantId) => {
        await seedTenant(tx, seedTenantId);
        const seededSubject = await insertSubject(tx, seedTenantId);
        const { token } = await actionTokenRepository(tx).issue({
          tenantId: seedTenantId,
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
        // verifyTenantAUnaffected below — an UPDATE an RLS policy narrows to
        // zero rows still "succeeds" with nothing touched.
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await actionTokenRepository(tx).peek(seeded.token);
        expect(found).not.toBeNull();
      },
    });
  });
});

describe('tenant isolation', () => {
  it('cannot consume a token minted in another tenant, and leaves it unconsumed', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seedTenantId) => {
        await seedTenant(tx, seedTenantId);
        const seededSubject = await insertSubject(tx, seedTenantId);
        const { token } = await actionTokenRepository(tx).issue({
          tenantId: seedTenantId,
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
      verifyTenantAUnaffected: async (tx, token) => {
        const rows = await tx
          .select({ consumedAt: actionTokens.consumedAt })
          .from(actionTokens)
          .where(eq(actionTokens.tokenHash, sha256HexForTest(token)));
        expect(rows[0]?.consumedAt).toBeNull();
      },
    });
  });

  // `issue` takes tenantId as a parameter the same way roleRepository.create
  // and groupRepository.create do, and both of those are probed for exactly
  // this: a caller connected under one tenant cannot mint a row claiming
  // another's id. This is also the only test that exercises
  // action_tokens_isolation's WITH CHECK on an INSERT — every other probe in
  // this file only ever reads under a foreign tenant.
  it('refuses to issue a token claiming another tenant’s id, and leaves that tenant untouched', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const subjectA = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      return insertSubject(tx, tenantA);
    });
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));

    expect(
      await causeMessage(
        withTenant(app.db, tenantB, (tx) =>
          actionTokenRepository(tx).issue({
            tenantId: tenantA,
            subjectId: subjectA,
            type: 'verify_email',
            ttlSeconds: TEST_TTL_SECONDS,
          }),
        ),
      ),
    ).toMatch(/row-level security/i);

    const rows = await withTenant(app.db, tenantA, (tx) =>
      tx.select({ tokenHash: actionTokens.tokenHash }).from(actionTokens),
    );
    expect(rows).toHaveLength(0);
  });
});
