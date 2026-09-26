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
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { sessionRepository } from '#/repository/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { type RequiredAction } from '#/schema/required-action';
import { sessions } from '#/schema/sessions';
import {
  advance,
  consumeAuthenticationSession,
  establishSession,
  startAuthentication,
} from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { nextRequiredAction } from '#/usecase/required-actions';

const SILENT_LOGGER = { error: (): void => undefined };

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

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';

async function seedTenantAndUser(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionBrowserFlow(tx, tenantId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
  await tx.insert(userCredentials).values({
    id: newId(),
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secretData: { hash: await hashPassword(PASSWORD) },
  });
  return subject.id;
}

describe('a pending required action blocks completion, not authentication', () => {
  it('authenticates correctly, but establishes no session while an action is owed', async () => {
    const tenantId = newId();

    const { authSessionId, subjectId } = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenantAndUser(tx, tenantId);
      await requiredActionRepository(tx).add(tenantId, subjectId, 'configure-totp');
      const { authSessionId } = await startAuthentication(tx, tenantId, request);
      return { authSessionId, subjectId };
    });

    const { outcome, action } = await withTenant(app.db, tenantId, async (tx) => {
      const outcome = await advance(
        tx,
        authSessionId,
        { username: USERNAME, password: PASSWORD },
        undefined,
        { logger: SILENT_LOGGER },
      );
      const pending =
        outcome.kind === 'success'
          ? await requiredActionRepository(tx).pendingFor(outcome.subjectId)
          : [];
      return { outcome, action: nextRequiredAction(pending) };
    });

    // Authentication itself succeeded — the password was right.
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
    expect(action).toBe('configure-totp');

    // Nothing a completed login would have produced exists: the
    // authentication session survives unconsumed, and no SSO session row
    // was ever created for this subject.
    const { consumedAt, sessionRows } = await withTenant(app.db, tenantId, async (tx) => {
      const record = await authenticationSessionRepository(tx).byId(authSessionId);
      const rows = await tx.select().from(sessions).where(eq(sessions.subjectId, subjectId));
      return { consumedAt: record?.consumedAt ?? null, sessionRows: rows };
    });
    expect(consumedAt).toBeNull();
    expect(sessionRows).toEqual([]);
  });

  it('completes the login once the action is done', async () => {
    const tenantId = newId();

    const { authSessionId, subjectId } = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenantAndUser(tx, tenantId);
      await requiredActionRepository(tx).add(tenantId, subjectId, 'update-password');
      const { authSessionId } = await startAuthentication(tx, tenantId, request);
      return { authSessionId, subjectId };
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const outcome = await advance(
        tx,
        authSessionId,
        { username: USERNAME, password: PASSWORD },
        undefined,
        { logger: SILENT_LOGGER },
      );
      if (outcome.kind !== 'success') throw new Error('expected authentication to succeed');
      const pending = await requiredActionRepository(tx).pendingFor(outcome.subjectId);
      expect(nextRequiredAction(pending)).toBe('update-password');

      await requiredActionRepository(tx).complete(outcome.subjectId, 'update-password');
      const remaining = await requiredActionRepository(tx).pendingFor(outcome.subjectId);
      expect(nextRequiredAction(remaining)).toBeNull();

      const consumed = await consumeAuthenticationSession(tx, authSessionId);
      expect(consumed).toBe(true);
      const { sessionId } = await establishSession(tx, tenantId, outcome.subjectId, 36_000, [
        'password',
      ]);
      const established = await sessionRepository(tx).byId(sessionId);
      expect(established?.subjectId).toBe(subjectId);
    });
  });

  it('runs a second pending action before the login can complete', async () => {
    const tenantId = newId();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenantAndUser(tx, tenantId);
      await requiredActionRepository(tx).add(tenantId, subjectId, 'update-password');
      await requiredActionRepository(tx).add(tenantId, subjectId, 'configure-totp');
      return subjectId;
    });

    await withTenant(app.db, tenantId, async (tx) => {
      const repository = requiredActionRepository(tx);
      expect(nextRequiredAction(await repository.pendingFor(subjectId))).toBe('update-password');

      await repository.complete(subjectId, 'update-password');
      expect(nextRequiredAction(await repository.pendingFor(subjectId))).toBe('configure-totp');

      await repository.complete(subjectId, 'configure-totp');
      expect(nextRequiredAction(await repository.pendingFor(subjectId))).toBeNull();
    });
  });
});

describe('requiredActionRepository', () => {
  it("cannot see a foreign tenant's pending actions through pendingFor", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedTenantAndUser(tx, tenantId);
        await requiredActionRepository(tx).add(tenantId, subjectId, 'configure-passkey');
        return subjectId;
      },
      verifySeeded: async (tx, subjectId) => {
        const pending = await requiredActionRepository(tx).pendingFor(subjectId);
        expect(pending).toEqual(['configure-passkey']);
      },
      attempt: async (tx, subjectId) => requiredActionRepository(tx).pendingFor(subjectId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  // Unlike pendingFor and complete, add supplies its own tenant_id rather
  // than being filtered by a row that already carries one — its isolation
  // rests entirely on PostgreSQL reusing the policy's USING clause as the
  // INSERT check, since no WITH CHECK is written. This is what proves that
  // reuse actually happens, rather than assuming it from the policy's shape.
  it('refuses to add a pending action under a tenant context that does not match', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const subjectA = await withTenant(app.db, tenantA, async (tx) =>
      seedTenantAndUser(tx, tenantA),
    );
    await withTenant(app.db, tenantB, async (tx) => {
      await tx.insert(tenants).values({ id: tenantB, name: `tenant-${tenantB}` });
    });

    let error: unknown;
    try {
      await withTenant(app.db, tenantB, async (tx) =>
        requiredActionRepository(tx).add(tenantA, subjectA, 'configure-totp'),
      );
      expect.unreachable('expected the cross-tenant insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('row-level security policy');

    const pendingUnderA = await withTenant(app.db, tenantA, async (tx) =>
      requiredActionRepository(tx).pendingFor(subjectA),
    );
    expect(pendingUnderA).toEqual([]);
  });

  it("does not remove a foreign tenant's pending action through complete", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedTenantAndUser(tx, tenantId);
        await requiredActionRepository(tx).add(tenantId, subjectId, 'generate-recovery-codes');
        return subjectId;
      },
      verifySeeded: async (tx, subjectId) => {
        const pending = await requiredActionRepository(tx).pendingFor(subjectId);
        expect(pending).toEqual(['generate-recovery-codes']);
      },
      attempt: async (tx, subjectId) => {
        await requiredActionRepository(tx).complete(subjectId, 'generate-recovery-codes');
        return null;
      },
      expectBlocked: () => {
        // The delete itself is not expected to throw — RLS filters the row
        // out of its own WHERE, so it silently deletes nothing.
      },
      verifyTenantAUnaffected: async (tx, subjectId) => {
        const pending = await requiredActionRepository(tx).pendingFor(subjectId);
        expect(pending).toEqual(['generate-recovery-codes']);
      },
    });
  });

  // Not expectCrossTenantMethodProbe: replaceAll's insert half raises a real
  // RLS violation at the Postgres level (the same reason the `add` test
  // above catches around the whole `withTenant`, not inside it) — catching
  // that in JS leaves the transaction aborted, and the implicit COMMIT
  // `withTenant` issues on a normal return then fails with an unrelated
  // "current transaction is aborted" error instead of the one under test.
  it('cannot replace a foreign tenant’s required actions through replaceAll', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const subjectA = await withTenant(app.db, tenantA, async (tx) => {
      const subjectId = await seedTenantAndUser(tx, tenantA);
      await requiredActionRepository(tx).add(tenantA, subjectId, 'configure-totp');
      return subjectId;
    });
    await withTenant(app.db, tenantB, async (tx) => {
      await tx.insert(tenants).values({ id: tenantB, name: `tenant-${tenantB}` });
    });

    let error: unknown;
    try {
      await withTenant(app.db, tenantB, async (tx) =>
        requiredActionRepository(tx).replaceAll(tenantA, subjectA, ['update-password']),
      );
      expect.unreachable('expected the cross-tenant replaceAll to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('row-level security policy');

    const pendingUnderA = await withTenant(app.db, tenantA, async (tx) =>
      requiredActionRepository(tx).pendingFor(subjectA),
    );
    expect(pendingUnderA).toEqual(['configure-totp']);
  });

  it('adding the same action twice does not duplicate it', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenantAndUser(tx, tenantId);
      const repository = requiredActionRepository(tx);
      await repository.add(tenantId, subjectId, 'configure-totp');
      await repository.add(tenantId, subjectId, 'configure-totp');
      expect(await repository.pendingFor(subjectId)).toEqual(['configure-totp']);
    });
  });

  it('refuses an action outside the four required actions', async () => {
    const tenantId = newId();
    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        const subjectId = await seedTenantAndUser(tx, tenantId);
        await requiredActionRepository(tx).add(
          tenantId,
          subjectId,
          'delete-account' as RequiredAction,
        );
      });
      expect.unreachable('expected the invalid action to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('user_required_actions_action');
  });
});
