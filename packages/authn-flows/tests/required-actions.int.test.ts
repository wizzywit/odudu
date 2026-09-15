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

async function seedRealmAndUser(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  await provisionBrowserFlow(tx, realmId);
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
  await tx.insert(userCredentials).values({
    id: newId(),
    realmId,
    subjectId: subject.id,
    type: 'password',
    secretData: { hash: await hashPassword(PASSWORD) },
  });
  return subject.id;
}

describe('a pending required action blocks completion, not authentication', () => {
  it('authenticates correctly, but establishes no session while an action is owed', async () => {
    const realmId = newId();

    const { authSessionId, subjectId } = await withRealm(app.db, realmId, async (tx) => {
      const subjectId = await seedRealmAndUser(tx, realmId);
      await requiredActionRepository(tx).add(realmId, subjectId, 'configure-totp');
      const { authSessionId } = await startAuthentication(tx, realmId, request);
      return { authSessionId, subjectId };
    });

    const { outcome, action } = await withRealm(app.db, realmId, async (tx) => {
      const outcome = await advance(tx, authSessionId, { username: USERNAME, password: PASSWORD });
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
    const { consumedAt, sessionRows } = await withRealm(app.db, realmId, async (tx) => {
      const record = await authenticationSessionRepository(tx).byId(authSessionId);
      const rows = await tx.select().from(sessions).where(eq(sessions.subjectId, subjectId));
      return { consumedAt: record?.consumedAt ?? null, sessionRows: rows };
    });
    expect(consumedAt).toBeNull();
    expect(sessionRows).toEqual([]);
  });

  it('completes the login once the action is done', async () => {
    const realmId = newId();

    const { authSessionId, subjectId } = await withRealm(app.db, realmId, async (tx) => {
      const subjectId = await seedRealmAndUser(tx, realmId);
      await requiredActionRepository(tx).add(realmId, subjectId, 'update-password');
      const { authSessionId } = await startAuthentication(tx, realmId, request);
      return { authSessionId, subjectId };
    });

    await withRealm(app.db, realmId, async (tx) => {
      const outcome = await advance(tx, authSessionId, { username: USERNAME, password: PASSWORD });
      if (outcome.kind !== 'success') throw new Error('expected authentication to succeed');
      const pending = await requiredActionRepository(tx).pendingFor(outcome.subjectId);
      expect(nextRequiredAction(pending)).toBe('update-password');

      await requiredActionRepository(tx).complete(outcome.subjectId, 'update-password');
      const remaining = await requiredActionRepository(tx).pendingFor(outcome.subjectId);
      expect(nextRequiredAction(remaining)).toBeNull();

      const consumed = await consumeAuthenticationSession(tx, authSessionId);
      expect(consumed).toBe(true);
      const { sessionId } = await establishSession(tx, realmId, outcome.subjectId, 36_000, [
        'password',
      ]);
      const established = await sessionRepository(tx).byId(sessionId);
      expect(established?.subjectId).toBe(subjectId);
    });
  });

  it('runs a second pending action before the login can complete', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      const subjectId = await seedRealmAndUser(tx, realmId);
      await requiredActionRepository(tx).add(realmId, subjectId, 'update-password');
      await requiredActionRepository(tx).add(realmId, subjectId, 'configure-totp');
      return subjectId;
    });

    await withRealm(app.db, realmId, async (tx) => {
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
  it("cannot see a foreign realm's pending actions through pendingFor", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        const subjectId = await seedRealmAndUser(tx, realmId);
        await requiredActionRepository(tx).add(realmId, subjectId, 'configure-passkey');
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

  it("does not remove a foreign realm's pending action through complete", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        const subjectId = await seedRealmAndUser(tx, realmId);
        await requiredActionRepository(tx).add(realmId, subjectId, 'generate-recovery-codes');
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
      verifyRealmAUnaffected: async (tx, subjectId) => {
        const pending = await requiredActionRepository(tx).pendingFor(subjectId);
        expect(pending).toEqual(['generate-recovery-codes']);
      },
    });
  });

  it('adding the same action twice does not duplicate it', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      const subjectId = await seedRealmAndUser(tx, realmId);
      const repository = requiredActionRepository(tx);
      await repository.add(realmId, subjectId, 'configure-totp');
      await repository.add(realmId, subjectId, 'configure-totp');
      expect(await repository.pendingFor(subjectId)).toEqual(['configure-totp']);
    });
  });

  it('refuses an action outside the four required actions', async () => {
    const realmId = newId();
    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        const subjectId = await seedRealmAndUser(tx, realmId);
        await requiredActionRepository(tx).add(
          realmId,
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
