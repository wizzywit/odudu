import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  loginFailureRepository,
  subjectRepository,
  userCredentials,
  users,
  type LoginFailureRecord,
} from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication, type AdvanceOutcome } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes } from '#/usecase/recovery-codes';
import { completeTotpEnrolment } from '#/usecase/totp-enrolment';

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
  // Enough connections that the parallel guesses below really overlap.
  appHandle = createDatabase(appUrl, { max: 10 });
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
const WRONG_PASSWORD = 'incorrect horse battery staple';
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const MAX_FAILURES = 3;

function clockAt(): FakeClock {
  return new FakeClock(new Date(Date.UTC(2032, 0, 1)));
}

interface Account {
  tenantId: string;
  subjectId: string;
}

// A tenant that locks at three failures for a minute, and a subject with a
// password and an authenticator, so the flow is password then a code.
async function seedAccount(
  clock: FakeClock,
  options: { totp?: boolean; maxFailures?: number } = {},
): Promise<Account> {
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `tenant-${tenantId}`,
      bruteForceMaxFailures: options.maxFailures ?? MAX_FAILURES,
      bruteForceLockoutSeconds: 60,
      bruteForceMaxLockoutSeconds: 240,
      bruteForceFailureResetSeconds: 3600,
    });
    await provisionBrowserFlow(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    if (options.totp !== false) {
      const enrolled = await completeTotpEnrolment(
        tx,
        {
          tenantId,
          subjectId: subject.id,
          secret: TOTP_SECRET,
          code: totpCode(TOTP_SECRET, totpCounter(clock.now())),
          authSessionId: newId(),
        },
        clock,
      );
      expect(enrolled).toEqual({ kind: 'enrolled' });
    }
    return subject.id;
  });
  // The enrolment's own code is spent; the next login needs a later step.
  clock.advance(31_000);
  return { tenantId, subjectId };
}

function run(
  account: Account,
  authSessionId: string,
  input: Parameters<typeof advance>[2],
  clock: FakeClock,
): Promise<AdvanceOutcome> {
  return withTenant(app.db, account.tenantId, (tx) =>
    advance(tx, authSessionId, input, clock, { logger: SILENT_LOGGER }),
  );
}

// A session whose first factor has passed: it now waits on the second.
async function passedPassword(
  account: Account,
  clock: FakeClock,
  password = PASSWORD,
): Promise<string> {
  const authSessionId = await withTenant(app.db, account.tenantId, async (tx) => {
    const started = await startAuthentication(tx, account.tenantId, request, clock);
    return started.authSessionId;
  });
  await run(account, authSessionId, { username: 'ada', password }, clock);
  return authSessionId;
}

// Outside the window of steps the server accepts, so never right.
function wrongCode(clock: FakeClock, n = 0): string {
  return totpCode(TOTP_SECRET, totpCounter(clock.now()) + 50 + n);
}

function rightCode(clock: FakeClock): string {
  return totpCode(TOTP_SECRET, totpCounter(clock.now()));
}

function onRecord(account: Account): Promise<LoginFailureRecord> {
  return withTenant(app.db, account.tenantId, (tx) =>
    loginFailureRepository(tx).forSubject(account.subjectId),
  );
}

function totpLastStep(account: Account): Promise<number | null> {
  return withTenant(app.db, account.tenantId, async (tx) => {
    const [record] = await credentialRepository(tx).listFor(account.subjectId, 'totp');
    return record?.secret.kind === 'totp' ? record.secret.lastStep : null;
  });
}

const REFUSED: AdvanceOutcome = { kind: 'failure', reason: 'invalid_credentials' };

describe('wrong codes at the second factor count toward the account lockout', () => {
  it('locks the account at the tenant threshold, after a correct password', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const session = await passedPassword(account, clock);

    for (let n = 0; n < MAX_FAILURES; n += 1) {
      expect(await run(account, session, { code: wrongCode(clock, n) }, clock)).toEqual(REFUSED);
    }

    const state = await onRecord(account);
    expect(state.failureCount).toBe(MAX_FAILURES);
    expect(state.lockedUntil).not.toBeNull();
  });

  it('does not lock one short of the threshold', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const session = await passedPassword(account, clock);

    for (let n = 0; n < MAX_FAILURES - 1; n += 1) {
      await run(account, session, { code: wrongCode(clock, n) }, clock);
    }

    expect((await onRecord(account)).lockedUntil).toBeNull();
  });

  it('keeps the failures a correct password found, instead of clearing them', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    for (let n = 0; n < MAX_FAILURES - 1; n += 1) {
      await passedPassword(account, clock, WRONG_PASSWORD);
    }

    const session = await passedPassword(account, clock);
    expect((await onRecord(account)).failureCount).toBe(MAX_FAILURES - 1);

    // So one wrong code is the failure that reaches the threshold.
    await run(account, session, { code: wrongCode(clock) }, clock);
    expect((await onRecord(account)).lockedUntil).not.toBeNull();
  });

  it('succeeds with the right code below the threshold, and then clears the run', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const session = await passedPassword(account, clock);
    await run(account, session, { code: wrongCode(clock, 0) }, clock);
    await run(account, session, { code: wrongCode(clock, 1) }, clock);
    expect((await onRecord(account)).failureCount).toBe(2);

    const done = await run(account, session, { code: rightCode(clock) }, clock);

    expect(done).toEqual({
      kind: 'success',
      subjectId: account.subjectId,
      authenticators: ['password', 'otp'],
    });
    expect((await onRecord(account)).failureCount).toBe(0);
  });

  it('refuses the right code on a locked account without verifying it', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const waiting = await passedPassword(account, clock);
    const attacker = await passedPassword(account, clock);
    for (let n = 0; n < MAX_FAILURES; n += 1) {
      await run(account, attacker, { code: wrongCode(clock, n) }, clock);
    }
    const before = await totpLastStep(account);

    const refused = await run(account, waiting, { code: rightCode(clock) }, clock);

    // Same answer a wrong code gets, and the code was never spent: a locked
    // account is not an oracle for whether a guess was right.
    expect(refused).toEqual(REFUSED);
    expect(await totpLastStep(account)).toBe(before);
  });

  it('lets the right code through once the lockout has run out', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const session = await passedPassword(account, clock);
    for (let n = 0; n < MAX_FAILURES; n += 1) {
      await run(account, session, { code: wrongCode(clock, n) }, clock);
    }

    clock.advance(61_000);

    const done = await run(account, session, { code: rightCode(clock) }, clock);
    expect(done.kind).toBe('success');
  });

  it('counts a replayed code, which is a failed attempt like any other', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const first = await passedPassword(account, clock);
    const code = rightCode(clock);
    expect((await run(account, first, { code }, clock)).kind).toBe('success');
    expect((await onRecord(account)).failureCount).toBe(0);

    const second = await passedPassword(account, clock);
    expect(await run(account, second, { code }, clock)).toEqual(REFUSED);

    expect((await onRecord(account)).failureCount).toBe(1);
  });

  it('counts every one of a set of simultaneous guesses', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock, { maxFailures: 6 });
    const sessions = await Promise.all(
      Array.from({ length: 6 }, () => passedPassword(account, clock)),
    );

    const outcomes = await Promise.all(
      sessions.map((session, n) => run(account, session, { code: wrongCode(clock, n) }, clock)),
    );

    expect(outcomes).toEqual(sessions.map(() => REFUSED));
    const state = await onRecord(account);
    // None slipped under the threshold: six in parallel are six on record.
    expect(state.failureCount).toBe(6);
    expect(state.lockedUntil).not.toBeNull();
  });

  it('answers a locked account as it answers a wrong code', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock);
    const session = await passedPassword(account, clock);
    const wrong = await run(account, session, { code: wrongCode(clock, 0) }, clock);
    await run(account, session, { code: wrongCode(clock, 1) }, clock);
    await run(account, session, { code: wrongCode(clock, 2) }, clock);

    const locked = await run(account, session, { code: wrongCode(clock, 3) }, clock);

    expect(locked).toEqual(wrong);
  });
});

describe('wrong recovery codes count too', () => {
  async function withCodes(clock: FakeClock): Promise<{ account: Account; codes: string[] }> {
    const account = await seedAccount(clock);
    const outcome = await withTenant(app.db, account.tenantId, (tx) =>
      beginRecoveryCodes(tx, { ...account, now: clock.now() }),
    );
    if (outcome.kind !== 'issued') throw new Error('expected a set to be issued');
    return { account, codes: [...outcome.offer.codes] };
  }

  it('locks the account at the threshold', async () => {
    const clock = clockAt();
    const { account } = await withCodes(clock);
    const session = await passedPassword(account, clock);

    for (let n = 0; n < MAX_FAILURES; n += 1) {
      const outcome = await run(
        account,
        session,
        { recoveryCode: `ZZZZZ-0000${String(n)}` },
        clock,
      );
      expect(outcome).toEqual(REFUSED);
    }

    expect((await onRecord(account)).lockedUntil).not.toBeNull();
  });

  it('refuses a right code on a locked account and leaves it unspent', async () => {
    const clock = clockAt();
    const { account, codes } = await withCodes(clock);
    const waiting = await passedPassword(account, clock);
    const attacker = await passedPassword(account, clock);
    for (let n = 0; n < MAX_FAILURES; n += 1) {
      await run(account, attacker, { recoveryCode: `ZZZZZ-0000${String(n)}` }, clock);
    }

    const refused = await run(account, waiting, { recoveryCode: codes[0] ?? '' }, clock);
    expect(refused).toEqual(REFUSED);

    // The refused attempt counted, so the lockout doubled to two minutes.
    clock.advance(121_000);
    const later = await run(account, waiting, { recoveryCode: codes[0] ?? '' }, clock);
    expect(later.kind).toBe('success');
  });

  it('clears the run when a right code completes the sign-in', async () => {
    const clock = clockAt();
    const { account, codes } = await withCodes(clock);
    const session = await passedPassword(account, clock);
    await run(account, session, { recoveryCode: 'ZZZZZ-00000' }, clock);
    expect((await onRecord(account)).failureCount).toBe(1);

    const done = await run(account, session, { recoveryCode: codes[0] ?? '' }, clock);

    expect(done.kind).toBe('success');
    expect((await onRecord(account)).failureCount).toBe(0);
  });
});

describe('a flow with no second factor is unchanged', () => {
  it('clears the failures before it when the password completes the sign-in', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock, { totp: false });
    await passedPassword(account, clock, WRONG_PASSWORD);
    await passedPassword(account, clock, WRONG_PASSWORD);
    expect((await onRecord(account)).failureCount).toBe(2);

    const session = await withTenant(app.db, account.tenantId, async (tx) => {
      const started = await startAuthentication(tx, account.tenantId, request, clock);
      return started.authSessionId;
    });
    const done = await run(account, session, { username: 'ada', password: PASSWORD }, clock);

    expect(done.kind).toBe('success');
    expect((await onRecord(account)).failureCount).toBe(0);
  });

  it('still refuses a correct password on a locked account without clearing it', async () => {
    const clock = clockAt();
    const account = await seedAccount(clock, { totp: false });
    for (let n = 0; n < MAX_FAILURES; n += 1) await passedPassword(account, clock, WRONG_PASSWORD);

    const session = await withTenant(app.db, account.tenantId, async (tx) => {
      const started = await startAuthentication(tx, account.tenantId, request, clock);
      return started.authSessionId;
    });
    const refused = await run(account, session, { username: 'ada', password: PASSWORD }, clock);

    expect(refused).toEqual(REFUSED);
    expect((await onRecord(account)).lockedUntil).not.toBeNull();
  });
});
