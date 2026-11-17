import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateRecoveryCodes, normaliseRecoveryCode } from '#/service/authenticators/recovery';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes, completeRecoveryCodes } from '#/usecase/recovery-codes';
import { onSecondFactorRemoved } from '#/usecase/second-factor-removed';
import { completeTotpEnrolment } from '#/usecase/totp-enrolment';

const SILENT_LOGGER = { error: (): void => undefined };
const PASSWORD = 'correct horse battery staple';
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
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

function clockAt(offsetMs = 0): FakeClock {
  return new FakeClock(new Date(Date.UTC(2032, 0, 1) + offsetMs));
}

interface Account {
  tenantId: string;
  subjectId: string;
}

async function seedAccount(factors: {
  totp: boolean;
  passkey: boolean;
  otpRequired?: boolean;
}): Promise<Account> {
  const tenantId = newId();
  const clock = clockAt();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `tenant-${tenantId}`,
      otpRequired: factors.otpRequired ?? false,
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
    if (factors.totp) {
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
    if (factors.passkey) {
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject.id,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'AAAA', counter: 0, transports: [] },
        lookupKey: `key-${newId()}`,
      });
    }
    return subject.id;
  });
  return { tenantId, subjectId };
}

// Ten rows with no second factor behind them, which issuing a set now refuses.
function holdCodes(account: Account, count = 10): Promise<void> {
  return withTenant(app.db, account.tenantId, async (tx) => {
    for (let n = 0; n < count; n += 1) {
      await credentialRepository(tx).insert({
        ...account,
        type: 'recovery-code',
        secret: { kind: 'recovery-code', hash: await hashPassword(`held-${String(n)}`) },
      });
    }
  });
}

function issueCodes(account: Account): Promise<readonly string[]> {
  return withTenant(app.db, account.tenantId, async (tx) => {
    const outcome = await beginRecoveryCodes(tx, { ...account, now: clockAt().now() });
    if (outcome.kind !== 'issued') throw new Error('expected a set to be issued');
    await requiredActionRepository(tx).complete(account.subjectId, 'generate-recovery-codes');
    return outcome.offer.codes;
  });
}

function acknowledged(account: Account): Promise<void> {
  return withTenant(app.db, account.tenantId, (tx) =>
    requiredActionRepository(tx).complete(account.subjectId, 'generate-recovery-codes'),
  );
}

function standing(account: Account, asTenant = account.tenantId) {
  return withTenant(app.db, asTenant, (tx) =>
    credentialRepository(tx).recoveryStanding(account.subjectId),
  );
}

function pending(account: Account): Promise<string[]> {
  return withTenant(app.db, account.tenantId, (tx) =>
    requiredActionRepository(tx).pendingFor(account.subjectId),
  );
}

function credentialIds(account: Account, type: 'totp' | 'webauthn'): Promise<string[]> {
  return withTenant(app.db, account.tenantId, async (tx) =>
    (await credentialRepository(tx).listFor(account.subjectId, type)).map((row) => row.id),
  );
}

async function removeAndNotify(account: Account, type: 'totp' | 'webauthn') {
  const recorded: unknown[] = [];
  const outcome = await withTenant(app.db, account.tenantId, async (tx) => {
    for (const id of await credentialIds(account, type)) {
      await credentialRepository(tx).deleteOne(id);
    }
    return onSecondFactorRemoved(tx, { subjectId: account.subjectId }, (detail) => {
      recorded.push(detail);
      return Promise.resolve();
    });
  });
  return { outcome, recorded };
}

describe('onSecondFactorRemoved', () => {
  it('deletes the whole set, spent rows too, when the last factor goes, and says so', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await issueCodes(account);
    await withTenant(app.db, account.tenantId, async (tx) => {
      const [first] = await credentialRepository(tx).listFor(account.subjectId, 'recovery-code');
      expect(await credentialRepository(tx).spendRecoveryCode(first?.id ?? '', new Date())).toBe(
        true,
      );
    });

    const { outcome, recorded } = await removeAndNotify(account, 'totp');

    expect(outcome).toEqual({ recoveryCodesRevoked: 10 });
    expect(recorded).toEqual([{ revoked: 10, reason: 'last_factor_removed' }]);
    expect(await standing(account)).toEqual({ unspent: 0, held: 0, hasTotp: false });
  });

  it('revokes the set with the last TOTP even while a passkey remains: a code can only stand in for a TOTP', async () => {
    const account = await seedAccount({ totp: true, passkey: true });
    await issueCodes(account);
    const { outcome, recorded } = await removeAndNotify(account, 'totp');
    expect(outcome).toEqual({ recoveryCodesRevoked: 10 });
    expect(recorded).toEqual([{ revoked: 10, reason: 'last_factor_removed' }]);
    expect(await standing(account)).toEqual({ unspent: 0, held: 0, hasTotp: false });
  });

  it('keeps the set while a TOTP remains, whatever happens to a passkey', async () => {
    const account = await seedAccount({ totp: true, passkey: true });
    await issueCodes(account);
    const { outcome } = await removeAndNotify(account, 'webauthn');
    expect(outcome).toEqual({ recoveryCodesRevoked: 0 });
    expect(await standing(account)).toMatchObject({ unspent: 10, hasTotp: true });
  });

  it('clears an owed set when no TOTP remains, since nothing is left to recover', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await withTenant(app.db, account.tenantId, (tx) =>
      requiredActionRepository(tx).add(
        account.tenantId,
        account.subjectId,
        'generate-recovery-codes',
      ),
    );
    await removeAndNotify(account, 'totp');
    expect(await pending(account)).toEqual([]);
  });

  it('does not count a recovery code as a factor', async () => {
    const account = await seedAccount({ totp: false, passkey: false });
    await holdCodes(account, 3);
    const { outcome } = await removeAndNotify(account, 'totp');
    expect(outcome).toEqual({ recoveryCodesRevoked: 3 });
  });

  it('writes nothing for a subject that holds no codes', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await acknowledged(account);
    const { outcome, recorded } = await removeAndNotify(account, 'totp');
    expect(outcome).toEqual({ recoveryCodesRevoked: 0 });
    expect(recorded).toEqual([]);
  });

  it("deletes nothing under a foreign tenant's context", async () => {
    const account = await seedAccount({ totp: false, passkey: false });
    await holdCodes(account);
    const foreign = newId();

    const outcome = await withTenant(app.db, foreign, (tx) =>
      onSecondFactorRemoved(tx, { subjectId: account.subjectId }, () => Promise.resolve()),
    );

    expect(outcome).toEqual({ recoveryCodesRevoked: 0 });
    expect(await standing(account)).toMatchObject({ unspent: 10 });
    expect(await standing(account, foreign)).toEqual({
      unspent: 0,
      held: 0,
      hasTotp: false,
    });
  });

  it('serialises with itself: two concurrent removals revoke the set once', async () => {
    const account = await seedAccount({ totp: true, passkey: true });
    await issueCodes(account);
    const counts = await Promise.all(
      (['totp', 'webauthn'] as const).map((type) =>
        withTenant(app.db, account.tenantId, async (tx) => {
          // The subject row lock every admin mutation takes before it removes a credential.
          await tx.execute(
            sql`select id from subjects where id = ${account.subjectId} for no key update`,
          );
          for (const id of await credentialIds(account, type)) {
            await credentialRepository(tx).deleteOne(id);
          }
          return onSecondFactorRemoved(tx, { subjectId: account.subjectId }, () =>
            Promise.resolve(),
          );
        }),
      ),
    );
    expect(counts.map((c) => c.recoveryCodesRevoked).sort()).toEqual([0, 10]);
    expect(await standing(account)).toMatchObject({ held: 0 });
  });
});

describe('the sign-in that completes with a second factor and no unspent code', () => {
  async function signIn(account: Account, clock: FakeClock, withTotpCode: boolean) {
    const authSessionId = await withTenant(app.db, account.tenantId, async (tx) => {
      const started = await startAuthentication(tx, account.tenantId, request, clock);
      return started.authSessionId;
    });
    await withTenant(app.db, account.tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock, {
        logger: SILENT_LOGGER,
      }),
    );
    if (!withTotpCode) return;
    const outcome = await withTenant(app.db, account.tenantId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(TOTP_SECRET, totpCounter(clock.now())) }, clock, {
        logger: SILENT_LOGGER,
      }),
    );
    expect(outcome.kind).toBe('success');
  }

  it('owes a set once, and not again after the set is saved', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await acknowledged(account);
    expect(await pending(account)).toEqual([]);

    await signIn(account, clockAt(90_000), true);
    expect(await pending(account)).toEqual(['generate-recovery-codes']);

    await withTenant(app.db, account.tenantId, (tx) =>
      beginRecoveryCodes(tx, { ...account, now: clockAt().now() }),
    );
    await withTenant(app.db, account.tenantId, (tx) => completeRecoveryCodes(tx, account));
    await signIn(account, clockAt(180_000), true);
    expect(await pending(account)).toEqual([]);
  });

  it('owes nothing to a subject who holds an unspent code', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await issueCodes(account);
    await signIn(account, clockAt(90_000), true);
    expect(await pending(account)).toEqual([]);
  });

  it('owes nothing to a subject with no second factor', async () => {
    const account = await seedAccount({ totp: false, passkey: false });
    await signIn(account, clockAt(90_000), false);
    expect(await pending(account)).toEqual([]);
  });

  it('owes nothing to a subject whose only second factor is a passkey: a code cannot stand in for one', async () => {
    const account = await seedAccount({ totp: false, passkey: true });
    await acknowledged(account);
    await signIn(account, clockAt(90_000), false);
    expect(await pending(account)).toEqual([]);
  });

  it('owes a set after the whole set is revoked while a factor remains', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await issueCodes(account);
    await withTenant(app.db, account.tenantId, (tx) =>
      credentialRepository(tx).deleteRecoveryCodes(account.subjectId),
    );
    await signIn(account, clockAt(90_000), true);
    expect(await pending(account)).toEqual(['generate-recovery-codes']);
  });
});

describe('re-enrolling after the factor was removed', () => {
  it('issues a fresh set, because the old one went with the factor', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    const old = await issueCodes(account);
    await removeAndNotify(account, 'totp');

    await withTenant(app.db, account.tenantId, async (tx) => {
      const clock = clockAt(300_000);
      await completeTotpEnrolment(
        tx,
        {
          tenantId: account.tenantId,
          subjectId: account.subjectId,
          secret: TOTP_SECRET,
          code: totpCode(TOTP_SECRET, totpCounter(clock.now())),
          authSessionId: newId(),
        },
        clock,
      );
    });

    expect(await pending(account)).toContain('generate-recovery-codes');
    expect(await standing(account)).toMatchObject({ held: 0 });

    // The reported defect: with the new TOTP in place the old set must not work again.
    const clock = clockAt(600_000);
    const authSessionId = await withTenant(app.db, account.tenantId, async (tx) => {
      const started = await startAuthentication(tx, account.tenantId, request, clock);
      return started.authSessionId;
    });
    await withTenant(app.db, account.tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock, {
        logger: SILENT_LOGGER,
      }),
    );
    const replayed = await withTenant(app.db, account.tenantId, (tx) =>
      advance(tx, authSessionId, { recoveryCode: old[0] ?? '' }, clock, { logger: SILENT_LOGGER }),
    );
    // No set is held, so the code step still asks for the app's code.
    expect(replayed.kind).toBe('challenge');
  });
});

describe('issuing a set', () => {
  it('is refused for a subject with no second factor, clears the owed action, and writes nothing', async () => {
    const account = await seedAccount({ totp: false, passkey: false });
    await withTenant(app.db, account.tenantId, (tx) =>
      requiredActionRepository(tx).add(
        account.tenantId,
        account.subjectId,
        'generate-recovery-codes',
      ),
    );

    const outcome = await withTenant(app.db, account.tenantId, (tx) =>
      beginRecoveryCodes(tx, { ...account, now: clockAt().now() }),
    );

    expect(outcome).toEqual({ kind: 'no_second_factor' });
    expect(await standing(account)).toMatchObject({ held: 0 });
    expect(await pending(account)).toEqual([]);
  });

  it('is refused for a subject that does not exist in the tenant', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    const outcome = await withTenant(app.db, newId(), (tx) =>
      beginRecoveryCodes(tx, { ...account, now: clockAt().now() }),
    );
    expect(outcome).toEqual({ kind: 'no_second_factor' });
  });

  // The issue holds the subject lock while its set is uncommitted; the removal
  // of the last factor, started meanwhile, waits for it and then finds the set
  // and revokes it. Without the lock the removal checks before the set is
  // visible, finds nothing to revoke, and both commit.
  it('never leaves a set behind a removed last factor, whichever starts first', async () => {
    for (let round = 0; round < 3; round += 1) {
      const account = await seedAccount({ totp: true, passkey: false });
      let releaseIssue: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        releaseIssue = resolve;
      });
      let issuedSet: () => void = () => undefined;
      const issuedAlready = new Promise<void>((resolve) => {
        issuedSet = resolve;
      });

      const issue = withTenant(app.db, account.tenantId, async (tx) => {
        const outcome = await beginRecoveryCodes(tx, { ...account, now: clockAt().now() });
        issuedSet();
        await hold;
        return outcome.kind;
      });
      await issuedAlready;
      const removal = withTenant(app.db, account.tenantId, async (tx) => {
        await tx.execute(
          sql`select id from subjects where id = ${account.subjectId} for no key update`,
        );
        for (const id of await credentialIds(account, 'totp')) {
          await credentialRepository(tx).deleteOne(id);
        }
        return onSecondFactorRemoved(tx, { subjectId: account.subjectId }, () => Promise.resolve());
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseIssue();

      expect(await issue).toBe('issued');
      expect(await removal).toEqual({ recoveryCodesRevoked: 10 });
      expect(await standing(account)).toEqual({ unspent: 0, held: 0, hasTotp: false });
    }
  });

  it('is refused when the removal commits first', async () => {
    const account = await seedAccount({ totp: true, passkey: false });
    await issueCodes(account);
    await removeAndNotify(account, 'totp');
    const outcome = await withTenant(app.db, account.tenantId, (tx) =>
      beginRecoveryCodes(tx, { ...account, now: clockAt().now() }),
    );
    expect(outcome).toEqual({ kind: 'no_second_factor' });
    expect(await standing(account)).toMatchObject({ held: 0 });
  });
});

describe('a recovery code that outlived the TOTP it stood in for', () => {
  const cases = [
    { otpRequired: true, passkey: false },
    { otpRequired: true, passkey: true },
    { otpRequired: false, passkey: false },
    { otpRequired: false, passkey: true },
  ];

  // The sign-in is by password, with a surviving code offered beside it. With no
  // TOTP held there is no code step for the code to take, so it is neither
  // accepted nor spent, in a tenant that requires a second factor or not: such
  // a subject signs in by password, or by passkey, and owes an enrolment where
  // the tenant requires one.
  it.each(cases)(
    'is neither accepted nor spent, with otpRequired $otpRequired and a passkey $passkey',
    async ({ otpRequired, passkey }) => {
      const account = await seedAccount({ totp: false, passkey, otpRequired });
      const codes = generateRecoveryCodes(2);
      await withTenant(app.db, account.tenantId, async (tx) => {
        for (const code of codes) {
          await credentialRepository(tx).insert({
            ...account,
            type: 'recovery-code',
            secret: {
              kind: 'recovery-code',
              hash: await hashPassword(normaliseRecoveryCode(code)),
            },
          });
        }
      });
      const clock = clockAt(90_000);
      const authSessionId = await withTenant(app.db, account.tenantId, async (tx) => {
        const started = await startAuthentication(tx, account.tenantId, request, clock);
        return started.authSessionId;
      });

      const outcome = await withTenant(app.db, account.tenantId, (tx) =>
        advance(
          tx,
          authSessionId,
          { username: 'ada', password: PASSWORD, recoveryCode: codes[0] ?? '' },
          clock,
          { logger: SILENT_LOGGER },
        ),
      );

      expect(outcome).toMatchObject({ kind: 'success', authenticators: ['password'] });
      expect(await standing(account)).toMatchObject({ unspent: 2, hasTotp: false });
      expect(await pending(account)).toEqual(otpRequired ? ['configure-totp'] : []);
    },
  );
});
