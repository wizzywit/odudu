import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import {
  hashPassword,
  loginFailureRepository,
  subjectRepository,
  userCredentials,
  users,
  type LoginFailureRecord,
} from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication, type AdvanceOutcome } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let secondHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
// A second pool, so "the lockout survives a fresh connection" is a claim
// about a row rather than about anything the first pool remembers.
let second: DatabaseHandle;

let appUrl: string;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
  secondHandle = createDatabase(appUrl, { max: 2 });
  second = secondHandle;
}, 120_000);

afterAll(async () => {
  await secondHandle?.close();
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
const WRONG = 'incorrect horse battery staple';

const START = new Date('2026-09-15T12:00:00Z');

// Short and shallow, so a test can spend a lockout by advancing a clock
// rather than by waiting: three strikes, a minute the first time, doubling
// to a ceiling of four, and an hour of quiet to forget a run.
interface BruteForce {
  maxFailures?: number;
  lockoutSeconds?: number;
  maxLockoutSeconds?: number;
  failureResetSeconds?: number;
}

interface Account {
  realmId: string;
  subjectId: string;
  username: string;
}

async function seedRealm(policy: BruteForce = {}): Promise<string> {
  const realmId = newId();
  await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({
      id: realmId,
      name: `realm-${realmId}`,
      bruteForceMaxFailures: policy.maxFailures ?? 3,
      bruteForceLockoutSeconds: policy.lockoutSeconds ?? 60,
      bruteForceMaxLockoutSeconds: policy.maxLockoutSeconds ?? 240,
      bruteForceFailureResetSeconds: policy.failureResetSeconds ?? 3600,
    });
    await provisionBrowserFlow(tx, realmId);
  });
  return realmId;
}

async function seedUser(realmId: string, username: string): Promise<Account> {
  const subjectId = await withRealm(app.db, realmId, async (tx) => {
    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    return subject.id;
  });
  return { realmId, subjectId, username };
}

async function seedAccount(policy: BruteForce = {}): Promise<Account> {
  return seedUser(await seedRealm(policy), 'ada');
}

function attempt(
  account: Pick<Account, 'realmId' | 'username'>,
  password: string,
  clock: FakeClock,
  handle: DatabaseHandle = app,
): Promise<AdvanceOutcome> {
  return withRealm(handle.db, account.realmId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, account.realmId, request, clock);
    return advance(tx, authSessionId, { username: account.username, password }, clock);
  });
}

function onRecord(account: Account): Promise<LoginFailureRecord> {
  return withRealm(app.db, account.realmId, (tx) =>
    loginFailureRepository(tx).forSubject(account.subjectId),
  );
}

const REFUSED: AdvanceOutcome = { kind: 'failure', reason: 'invalid_credentials' };

describe('[RFC6749-2.3.1-03] repeated wrong passwords lock the account out', () => {
  it('counts the failures, locks at the threshold, and says nothing about either', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();

    expect(await attempt(account, WRONG, clock)).toEqual(REFUSED);
    expect(await onRecord(account)).toMatchObject({ failureCount: 1, lockedUntil: null });
    expect(await attempt(account, WRONG, clock)).toEqual(REFUSED);
    expect(await onRecord(account)).toMatchObject({ failureCount: 2, lockedUntil: null });

    // The third is the one that locks, and it answers exactly as the first
    // two did: the refusal carries no reason a form could render, so the
    // page that renders it cannot say an account exists or is under attack.
    expect(await attempt(account, WRONG, clock)).toEqual(REFUSED);
    expect(await onRecord(account)).toMatchObject({
      failureCount: 3,
      lockedUntil: new Date(START.getTime() + 60_000),
    });
  });

  it('refuses the right password while the account is locked', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();
    for (let i = 0; i < 3; i++) await attempt(account, WRONG, clock);

    expect(await attempt(account, PASSWORD, clock)).toEqual(REFUSED);
  });

  // An attempt during the lockout is still an attempt: counting it is what
  // keeps a locked account the same cost — the same read and the same write
  // — as an unlocked one, so nothing can be learned from how fast the
  // refusal comes back. The price is that hammering a locked account
  // extends its lockout, which is the right way round for the attacker.
  it('counts an attempt made during a lockout, and extends it', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();
    for (let i = 0; i < 3; i++) await attempt(account, WRONG, clock);

    clock.advance(30_000);
    expect(await attempt(account, WRONG, clock)).toEqual(REFUSED);

    expect(await onRecord(account)).toMatchObject({
      failureCount: 4,
      lockedUntil: new Date(START.getTime() + 30_000 + 120_000),
    });
  });

  it('lets the right password through once the lockout has expired', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();
    for (let i = 0; i < 3; i++) await attempt(account, WRONG, clock);

    clock.advance(60_000);

    expect(await attempt(account, PASSWORD, clock)).toEqual({
      kind: 'success',
      subjectId: account.subjectId,
      authenticators: ['password'],
    });
  });

  it('clears the run of failures when a password is accepted', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();
    await attempt(account, WRONG, clock);
    await attempt(account, WRONG, clock);

    expect(await attempt(account, PASSWORD, clock)).toMatchObject({ kind: 'success' });

    expect(await onRecord(account)).toEqual({
      failureCount: 0,
      firstFailureAt: null,
      lastFailureAt: null,
      lockedUntil: null,
    });
  });

  // The counter is a row, not process memory: a deployment behind two
  // servers, or one that restarts mid-attack, refuses the next attempt
  // exactly as the one that recorded the failures would have.
  it('locks an account out through a connection that never saw the failures', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();
    for (let i = 0; i < 3; i++) await attempt(account, WRONG, clock);

    expect(await attempt(account, PASSWORD, clock, second)).toEqual(REFUSED);
  });

  it('locks one subject out without touching another in the same realm', async () => {
    const clock = new FakeClock(START);
    const realmId = await seedRealm();
    const ada = await seedUser(realmId, 'ada');
    const grace = await seedUser(realmId, 'grace');

    for (let i = 0; i < 3; i++) await attempt(ada, WRONG, clock);

    expect(await onRecord(grace)).toMatchObject({ failureCount: 0, lockedUntil: null });
    expect(await attempt(grace, PASSWORD, clock)).toMatchObject({ kind: 'success' });
  });

  // Two wrong passwords arriving together must count twice. Read-then-write
  // would have both read the same count and written the same number, which
  // is a free attempt for every request an attacker can run in parallel.
  it('counts every concurrent failure, not just the one that wrote last', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount({ maxFailures: 20 });

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => attempt(account, WRONG, clock)),
    );

    expect(outcomes).toEqual([REFUSED, REFUSED, REFUSED, REFUSED]);
    expect(await onRecord(account)).toMatchObject({ failureCount: 4 });
  });

  it('forgets a run of failures after the realm quiet period, and starts again at one', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();
    await attempt(account, WRONG, clock);
    await attempt(account, WRONG, clock);

    clock.advance(3_600_000);
    expect(await attempt(account, WRONG, clock)).toEqual(REFUSED);

    expect(await onRecord(account)).toMatchObject({ failureCount: 1, lockedUntil: null });
  });

  // first_failure_at is nothing the lockout arithmetic reads — the quiet
  // period is measured from the most recent failure — so the only thing
  // that keeps it honest is asserting it: the repository stamps it when a
  // run begins and leaves it alone for as long as the run continues.
  it('dates the run from its first failure, and re-dates it when the run restarts', async () => {
    const clock = new FakeClock(START);
    const account = await seedAccount();

    await attempt(account, WRONG, clock);
    clock.advance(10_000);
    await attempt(account, WRONG, clock);

    expect(await onRecord(account)).toMatchObject({
      firstFailureAt: START,
      lastFailureAt: new Date(START.getTime() + 10_000),
    });

    clock.advance(3_600_000);
    await attempt(account, WRONG, clock);

    const restarted = clock.now();
    expect(await onRecord(account)).toMatchObject({
      firstFailureAt: restarted,
      lastFailureAt: restarted,
    });
  });
});

describe('an unknown username costs what a wrong password costs', () => {
  // The placeholder subject id the unknown-username path is keyed on has no
  // row in `subjects`, so the failure write must find nothing to write
  // rather than violate its foreign key — an error there would abort the
  // transaction the login runs in and turn a refusal into a 500.
  it('refuses an unknown username without recording anything or raising', async () => {
    const clock = new FakeClock(START);
    const realmId = await seedRealm();
    await seedUser(realmId, 'ada');

    for (let i = 0; i < 5; i++) {
      expect(await attempt({ realmId, username: 'nobody' }, WRONG, clock)).toEqual(REFUSED);
    }

    const rows = await withRealm(app.db, realmId, (tx) =>
      tx.execute(sql`select count(*)::int as n from login_failures`),
    );
    expect((rows as unknown as { n: number }[])[0]?.n).toBe(0);
  });

  // A username nobody holds must not become a way to lock out somebody who
  // does: the counter is keyed by subject, so an unknown name has nowhere
  // to accumulate and the real account's own attempt still succeeds.
  it('leaves the real accounts of the realm signable-into', async () => {
    const clock = new FakeClock(START);
    const realmId = await seedRealm();
    const ada = await seedUser(realmId, 'ada');

    for (let i = 0; i < 5; i++) await attempt({ realmId, username: 'nobody' }, WRONG, clock);

    expect(await attempt(ada, PASSWORD, clock)).toMatchObject({ kind: 'success' });
  });
});
