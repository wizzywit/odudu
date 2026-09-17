import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication, type AdvanceOutcome } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { completeUpdatePassword, type UpdatePasswordOutcome } from '#/usecase/update-password';

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

const PASSWORD = 'correct horse battery staple';

interface RealmPolicy {
  maxAgeDays?: number;
  historyDepth?: number;
  minLength?: number;
}

interface Account {
  realmId: string;
  subjectId: string;
}

async function seedAccount(policy: RealmPolicy = {}): Promise<Account> {
  const realmId = newId();
  const subjectId = await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({
      id: realmId,
      name: `realm-${realmId}`,
      passwordMaxAgeDays: policy.maxAgeDays ?? 0,
      passwordHistoryDepth: policy.historyDepth ?? 0,
      passwordMinLength: policy.minLength ?? 8,
    });
    await provisionBrowserFlow(tx, realmId);
    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    return subject.id;
  });
  return { realmId, subjectId };
}

// The only way to stand a password in the past: created_at is written by
// the database's own now(), not by the clock a test injects.
async function agePassword(account: Account, days: number): Promise<void> {
  await withRealm(app.db, account.realmId, (tx) =>
    tx
      .update(userCredentials)
      .set({ createdAt: sql`now() - ${`${String(days)} days`}::interval` })
      .where(
        and(eq(userCredentials.subjectId, account.subjectId), eq(userCredentials.type, 'password')),
      ),
  );
}

// The real clock, deliberately: a password's age is the distance between
// created_at, which the database writes with its own now(), and the instant
// the flow judges it at. A fake clock years from that would expire
// everything and prove nothing about the limit.
function signIn(account: Account, password: string): Promise<AdvanceOutcome> {
  return withRealm(app.db, account.realmId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, account.realmId, request);
    return advance(tx, authSessionId, { username: 'ada', password });
  });
}

function pending(account: Account): Promise<string[]> {
  return withRealm(app.db, account.realmId, (tx) =>
    requiredActionRepository(tx).pendingFor(account.subjectId),
  );
}

function change(account: Account, password: string): Promise<UpdatePasswordOutcome> {
  return withRealm(app.db, account.realmId, (tx) =>
    completeUpdatePassword(tx, {
      realmId: account.realmId,
      subjectId: account.subjectId,
      password,
    }),
  );
}

function historyHashes(account: Account): Promise<string[]> {
  return withRealm(app.db, account.realmId, (tx) =>
    credentialRepository(tx).passwordHistory(account.subjectId),
  );
}

describe('a password past the realm maximum age is changed, not refused', () => {
  it('owes update-password and still authenticates the expired password', async () => {
    const account = await seedAccount({ maxAgeDays: 90 });
    await agePassword(account, 91);

    const outcome = await signIn(account, PASSWORD);

    expect(outcome).toEqual({
      kind: 'success',
      subjectId: account.subjectId,
      authenticators: ['password'],
    });
    expect(await pending(account)).toEqual(['update-password']);
  });

  it('owes nothing for a password inside the maximum age', async () => {
    const account = await seedAccount({ maxAgeDays: 90 });
    await agePassword(account, 89);

    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
    expect(await pending(account)).toEqual([]);
  });

  it('owes nothing in a realm that does not age passwords out', async () => {
    const account = await seedAccount();
    await agePassword(account, 3650);

    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
    expect(await pending(account)).toEqual([]);
  });

  // The action has to go, and the new password has to date from the change:
  // a rotation that left created_at alone would re-owe the action on the
  // very next login and never let one finish.
  it('clears the action when the password is changed, and does not re-owe it', async () => {
    const account = await seedAccount({ maxAgeDays: 90 });
    await agePassword(account, 91);
    await signIn(account, PASSWORD);

    expect(await change(account, 'a whole new passphrase')).toEqual({ kind: 'updated' });
    expect(await pending(account)).toEqual([]);

    expect(await signIn(account, 'a whole new passphrase')).toMatchObject({ kind: 'success' });
    expect(await pending(account)).toEqual([]);
  });
});

describe('the realm password history refuses a password the subject has had', () => {
  it('refuses the password in force and the retired ones inside the depth', async () => {
    const account = await seedAccount({ historyDepth: 2 });
    await change(account, 'second passphrase here');
    await change(account, 'third passphrase here');

    expect(await change(account, 'third passphrase here')).toEqual({
      kind: 'rejected',
      violations: ['Password must not be one you have used before.'],
    });
    expect(await change(account, 'second passphrase here')).toEqual({
      kind: 'rejected',
      violations: ['Password must not be one you have used before.'],
    });
    expect(await change(account, PASSWORD)).toEqual({
      kind: 'rejected',
      violations: ['Password must not be one you have used before.'],
    });
  });

  it('accepts a password retired further back than the depth remembers', async () => {
    const account = await seedAccount({ historyDepth: 1 });
    await change(account, 'second passphrase here');
    await change(account, 'third passphrase here');

    // PASSWORD and 'second passphrase here' were both retired; a depth of
    // one keeps only the most recent of them, so the first is free again.
    expect(await change(account, PASSWORD)).toEqual({ kind: 'updated' });
  });

  it('remembers nothing, and refuses nothing, at a depth of zero', async () => {
    const account = await seedAccount();
    await change(account, 'second passphrase here');

    expect(await historyHashes(account)).toEqual([]);
    expect(await change(account, 'second passphrase here')).toEqual({ kind: 'updated' });
  });

  it('stores the retired hash as a password-history row, and only the depth of them', async () => {
    const account = await seedAccount({ historyDepth: 2 });
    const displaced = await withRealm(app.db, account.realmId, (tx) =>
      credentialRepository(tx).passwordFor(account.subjectId),
    );

    await change(account, 'second passphrase here');
    expect(await historyHashes(account)).toEqual([displaced]);

    await change(account, 'third passphrase here');
    await change(account, 'fourth passphrase here');
    expect(await historyHashes(account)).toHaveLength(2);
    expect(await historyHashes(account)).not.toContain(displaced);
  });

  // passwordFor filters type = 'password', so a retired hash is not a
  // credential any login can reach. Pinned here because a widening of that
  // query would turn every remembered password back into a working one.
  it('never authenticates a login with a retired password', async () => {
    const account = await seedAccount({ historyDepth: 4 });
    await change(account, 'second passphrase here');

    expect(await historyHashes(account)).toHaveLength(1);
    expect(await signIn(account, PASSWORD)).toEqual({
      kind: 'failure',
      reason: 'invalid_credentials',
    });
    expect(await signIn(account, 'second passphrase here')).toMatchObject({ kind: 'success' });
  });
});

describe('the realm password policy binds the change-password action', () => {
  it('refuses a candidate that breaks the realm minimum length', async () => {
    const account = await seedAccount({ minLength: 12 });

    expect(await change(account, 'short')).toEqual({
      kind: 'rejected',
      violations: ['Password must be at least 12 characters long.'],
    });
  });

  it('refuses an empty submission against the same minimum, not as a special case', async () => {
    const account = await seedAccount();

    expect(await change(account, '')).toEqual({
      kind: 'rejected',
      violations: ['Password must be at least 8 characters long.'],
    });
  });

  it('collects every rule the candidate breaks, not just the first', async () => {
    const account = await seedAccount({ minLength: 20 });

    expect(await change(account, 'ada')).toEqual({
      kind: 'rejected',
      violations: [
        'Password must be at least 20 characters long.',
        'Password must not contain the username.',
      ],
    });
  });

  // A refused candidate must leave the account exactly as it was: the old
  // password still works and nothing was retired.
  it('writes nothing at all for a refused candidate', async () => {
    const account = await seedAccount({ historyDepth: 4, minLength: 12 });

    expect(await change(account, 'short')).toMatchObject({ kind: 'rejected' });

    expect(await historyHashes(account)).toEqual([]);
    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
  });
});
