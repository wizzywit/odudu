import { totpCode, totpCounter } from '@odudu/crypto';
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
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { authenticationExecutions } from '#/schema/execution';
import { RECOVERY_CODE_COUNT } from '#/service/authenticators/recovery';
import {
  advance,
  pendingChallenge,
  startAuthentication,
  type AdvanceOutcome,
} from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes, completeRecoveryCodes } from '#/usecase/recovery-codes';
import { completeTotpEnrolment } from '#/usecase/totp-enrolment';

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
  // max: 5, so two overlapping transactions get distinct connections and
  // the race below is a real one rather than two turns on the same session.
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

function clockAt(offsetMs = 0): FakeClock {
  return new FakeClock(new Date(Date.UTC(2031, 0, 1) + offsetMs));
}

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  await provisionBrowserFlow(tx, realmId);
}

// Any valid base32 secret: no test here ever computes a code from it. What
// it buys is a subject the OTP step applies to, which is the only state a
// recovery code has anything to stand in for.
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

async function enrolTotp(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
  clock: FakeClock,
): Promise<void> {
  const outcome = await completeTotpEnrolment(
    tx,
    {
      realmId,
      subjectId,
      secret: TOTP_SECRET,
      code: totpCode(TOTP_SECRET, totpCounter(clock.now())),
    },
    clock,
  );
  expect(outcome).toEqual({ kind: 'enrolled' });
}

async function seedUser(
  tx: RealmScopedDatabase,
  realmId: string,
  username: string,
): Promise<string> {
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
}

interface Account {
  realmId: string;
  subjectId: string;
  codes: readonly string[];
}

// A subject with a second factor enrolled and a set of recovery codes: the
// state this whole feature exists for, since a recovery code substitutes
// for a factor that has to be in play for anything to substitute for.
async function seedAccountWithCodes(clock: FakeClock, username = 'ada'): Promise<Account> {
  const realmId = newId();
  const subjectId = await withRealm(app.db, realmId, async (tx) => {
    await seedRealm(tx, realmId);
    const subject = await seedUser(tx, realmId, username);
    await enrolTotp(tx, realmId, subject, clock);
    return subject;
  });
  const offer = await withRealm(app.db, realmId, (tx) =>
    beginRecoveryCodes(tx, { realmId, subjectId }),
  );
  return { realmId, subjectId, codes: offer.codes };
}

function start(realmId: string, clock: FakeClock): Promise<string> {
  return withRealm(app.db, realmId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, realmId, request, clock);
    return authSessionId;
  });
}

async function signInWithPassword(
  realmId: string,
  clock: FakeClock,
  username = 'ada',
): Promise<string> {
  const authSessionId = await start(realmId, clock);
  await withRealm(app.db, realmId, (tx) =>
    advance(tx, authSessionId, { username, password: PASSWORD }, clock),
  );
  return authSessionId;
}

function present(
  realmId: string,
  authSessionId: string,
  recoveryCode: string,
  clock: FakeClock,
): Promise<AdvanceOutcome> {
  return withRealm(app.db, realmId, (tx) => advance(tx, authSessionId, { recoveryCode }, clock));
}

function storedCodes(
  account: Account,
): Promise<{ usedAt: string | undefined; lastUsedAt: Date | null }[]> {
  return withRealm(app.db, account.realmId, async (tx) => {
    const rows = await credentialRepository(tx).listFor(account.subjectId, 'recovery-code');
    return rows.map((row) => ({
      usedAt: row.secret.kind === 'recovery-code' ? row.secret.usedAt : undefined,
      lastUsedAt: row.lastUsedAt,
    }));
  });
}

describe('a recovery code stands in for the second factor, once', () => {
  it('issues ten codes and stores a hash of each, never the code', async () => {
    const account = await seedAccountWithCodes(clockAt());

    expect(account.codes).toHaveLength(RECOVERY_CODE_COUNT);
    const rows = await storedCodes(account);
    expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
    expect(rows.every((row) => row.usedAt === undefined)).toBe(true);

    const secrets = await owner.db.select().from(userCredentials);
    const plaintext = JSON.stringify(secrets);
    for (const code of account.codes) {
      expect(plaintext).not.toContain(code);
    }
  });

  it('signs a subject in with a code, and refuses the same code as already used', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    const [code] = account.codes;
    expect(code).toBeDefined();

    const first = await present(
      account.realmId,
      await signInWithPassword(account.realmId, clock),
      code ?? '',
      clock,
    );
    expect(first).toEqual({
      kind: 'success',
      subjectId: account.subjectId,
      authenticators: ['password', 'recovery-code'],
    });

    const again = await present(
      account.realmId,
      await signInWithPassword(account.realmId, clock),
      code ?? '',
      clock,
    );
    expect(again).toEqual({ kind: 'failure', reason: 'already_used' });
  });

  // ADR 0021's reasoning applies to every single-use credential: the row is
  // what makes a replay distinguishable from a code that never existed, and
  // deleting it would lose exactly that.
  it('keeps the spent row, marked used, rather than deleting it', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    const [code] = account.codes;

    await present(
      account.realmId,
      await signInWithPassword(account.realmId, clock),
      code ?? '',
      clock,
    );

    const rows = await storedCodes(account);
    expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
    const spent = rows.filter((row) => row.usedAt !== undefined);
    expect(spent).toHaveLength(1);
    expect(spent[0]?.usedAt).toBe(clock.now().toISOString());
    expect(spent[0]?.lastUsedAt).toEqual(clock.now());
  });

  it('leaves the other nine usable', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);

    for (const code of account.codes) {
      const outcome = await present(
        account.realmId,
        await signInWithPassword(account.realmId, clock),
        code,
        clock,
      );
      expect(outcome).toMatchObject({ kind: 'success', subjectId: account.subjectId });
    }

    const rows = await storedCodes(account);
    expect(rows.filter((row) => row.usedAt !== undefined)).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('refuses a code that was never issued', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);

    const outcome = await present(
      account.realmId,
      await signInWithPassword(account.realmId, clock),
      'ZZZZZ-ZZZZZ',
      clock,
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('replaces the whole set when a subject generates again, invalidating the old ten', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);

    const reissued = await withRealm(app.db, account.realmId, (tx) =>
      beginRecoveryCodes(tx, { realmId: account.realmId, subjectId: account.subjectId }),
    );
    expect(reissued.replaced).toBe(true);
    expect(await storedCodes(account)).toHaveLength(RECOVERY_CODE_COUNT);

    const old = await present(
      account.realmId,
      await signInWithPassword(account.realmId, clock),
      account.codes[0] ?? '',
      clock,
    );
    expect(old).toEqual({ kind: 'failure', reason: 'invalid_credentials' });

    const fresh = await present(
      account.realmId,
      await signInWithPassword(account.realmId, clock),
      reissued.codes[0] ?? '',
      clock,
    );
    expect(fresh).toMatchObject({ kind: 'success', subjectId: account.subjectId });
  });

  it("does not authenticate one subject with another's code from the same realm", async () => {
    const clock = clockAt();
    const ada = await seedAccountWithCodes(clock, 'ada');
    const bob = await withRealm(app.db, ada.realmId, (tx) => seedUser(tx, ada.realmId, 'bob'));
    const bobsCodes = await withRealm(app.db, ada.realmId, (tx) =>
      beginRecoveryCodes(tx, { realmId: ada.realmId, subjectId: bob }),
    );

    // ada's attempt, bob's own valid code: the codes are read for the
    // subject the attempt is bound to, so bob's list is never consulted.
    const outcome = await present(
      ada.realmId,
      await signInWithPassword(ada.realmId, clock, 'ada'),
      bobsCodes.codes[0] ?? '',
      clock,
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
    expect(
      (await storedCodes({ ...ada, subjectId: bob })).filter((row) => row.usedAt !== undefined),
    ).toEqual([]);
  });
});

describe('one code, one login', () => {
  // Two overlapping transactions, each past its own password step, both
  // presenting the same code: the UPDATE's own predicate on usedAt is the
  // decision, so the second serializes on the row and finds nothing to
  // update. A read-then-write pair would let both through.
  it('accepts a code once when two concurrent submissions present it', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    const code = account.codes[0] ?? '';

    const sessions = await Promise.all([
      signInWithPassword(account.realmId, clock),
      signInWithPassword(account.realmId, clock),
    ]);
    const outcomes = await Promise.all(
      sessions.map((authSessionId) => present(account.realmId, authSessionId, code, clock)),
    );

    expect(outcomes.filter((outcome) => outcome.kind === 'success')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'failure')).toEqual([
      { kind: 'failure', reason: 'invalid_credentials' },
    ]);
    expect((await storedCodes(account)).filter((row) => row.usedAt !== undefined)).toHaveLength(1);
  });
});

describe('the second-factor form offers both, and the recovery code wins the step', () => {
  it('asks for a code from the app until a recovery code is actually submitted', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return seedUser(tx, realmId, 'ada');
    });
    // A TOTP credential, so the OTP step is the one that would otherwise run.
    await withRealm(app.db, realmId, (tx) => enrolTotp(tx, realmId, subjectId, clock));

    const authSessionId = await start(realmId, clock);
    expect(
      await withRealm(app.db, realmId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      ),
    ).toEqual({ kind: 'challenge', form: 'otp' });
    expect(
      await withRealm(app.db, realmId, (tx) => pendingChallenge(tx, authSessionId, clock)),
    ).toEqual({ kind: 'challenge', form: 'otp' });

    // Fresh codes: the enrolment above owed a set, and asking for them is
    // what a subject who has just lost the authenticator would have done.
    const offer = await withRealm(app.db, realmId, (tx) =>
      beginRecoveryCodes(tx, { realmId, subjectId }),
    );
    const outcome = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { recoveryCode: offer.codes[0] ?? '' }, clock),
    );

    // The OTP step stands down for the rest of the attempt: a subject who
    // reached for a recovery code cannot then produce a code from the
    // authenticator they lost.
    expect(outcome).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'recovery-code'],
    });
  });
});

// A conditional group whose only member does not apply counts as satisfied
// (isGroupSatisfied), so standing the OTP step down for a submission that
// merely carries a recovery_code field would leave both second-factor
// groups satisfied and complete a two-factor login on the password alone.
// The field is the submission's to choose; whether a recovery step runs is
// not.
describe('the OTP step stands down only for a recovery step that actually runs', () => {
  it('challenges for a code when the subject holds none, however the field is filled', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await seedUser(tx, realmId, 'ada');
      await enrolTotp(tx, realmId, subject, clock);
      return subject;
    });
    expect(
      await withRealm(app.db, realmId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'recovery-code'),
      ),
    ).toEqual([]);

    const authSessionId = await signInWithPassword(realmId, clock);
    const outcome = await present(realmId, authSessionId, 'A', clock);

    expect(outcome).toEqual({ kind: 'challenge', form: 'otp' });
  });

  it('challenges for a code when the realm has no recovery step, even for a code it would accept', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    await withRealm(app.db, account.realmId, (tx) =>
      tx
        .delete(authenticationExecutions)
        .where(eq(authenticationExecutions.authenticator, 'recovery-code')),
    );

    const authSessionId = await signInWithPassword(account.realmId, clock);
    const outcome = await present(account.realmId, authSessionId, account.codes[0] ?? '', clock);

    expect(outcome).toEqual({ kind: 'challenge', form: 'otp' });
    // Nothing was spent: the step the code would have answered never ran.
    expect((await storedCodes(account)).filter((row) => row.usedAt !== undefined)).toEqual([]);
  });
});

describe('enrolling a second factor asks for a recovery path', () => {
  it('owes generate-recovery-codes to a subject who has just enrolled TOTP', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return seedUser(tx, realmId, 'ada');
    });

    await withRealm(app.db, realmId, (tx) => enrolTotp(tx, realmId, subjectId, clock));

    const pending = await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(pending).toContain('generate-recovery-codes');
  });

  // A second factor does not invalidate a list the subject has already
  // saved, and re-issuing would silently retire the copy on their paper.
  it('does not ask a subject who already holds codes', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await seedUser(tx, realmId, 'ada');
      await beginRecoveryCodes(tx, { realmId, subjectId: subject });
      return subject;
    });

    await withRealm(app.db, realmId, (tx) => enrolTotp(tx, realmId, subjectId, clock));

    const pending = await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(pending).not.toContain('generate-recovery-codes');
  });

  it('completes the action on acknowledgement, and refuses one with no codes stored', async () => {
    const account = await seedAccountWithCodes(clockAt());
    await withRealm(app.db, account.realmId, (tx) =>
      requiredActionRepository(tx).add(
        account.realmId,
        account.subjectId,
        'generate-recovery-codes',
      ),
    );

    expect(
      await withRealm(app.db, account.realmId, (tx) =>
        completeRecoveryCodes(tx, { subjectId: account.subjectId }),
      ),
    ).toEqual({ kind: 'acknowledged' });
    expect(
      await withRealm(app.db, account.realmId, (tx) =>
        requiredActionRepository(tx).pendingFor(account.subjectId),
      ),
    ).not.toContain('generate-recovery-codes');

    const bare = await withRealm(app.db, account.realmId, async (tx) => {
      const subjectId = await seedUser(tx, account.realmId, 'bare');
      return completeRecoveryCodes(tx, { subjectId });
    });
    expect(bare).toEqual({ kind: 'rejected', reason: 'none_issued' });
  });
});

describe('credentialRepository — the recovery-code writes', () => {
  it('cannot spend a code under a different realm context, and leaves the row alone', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subjectId = await seedUser(tx, realmId, 'ada');
        await beginRecoveryCodes(tx, { realmId, subjectId });
        const [stored] = await credentialRepository(tx).listFor(subjectId, 'recovery-code');
        if (stored === undefined) throw new Error('expected the seeded codes back');
        return { subjectId, id: stored.id };
      },
      verifySeeded: async (tx, seeded) => {
        const rows = await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code');
        expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
      },
      attempt: async (tx, seeded) =>
        credentialRepository(tx).spendRecoveryCode(seeded.id, new Date()),
      expectBlocked: (result) => {
        // RLS filters the row out of the UPDATE's own WHERE, so nothing is
        // updated and the call reports the code as unspent.
        expect(result).toBe(false);
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const rows = await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code');
        expect(
          rows.filter(
            (row) => row.secret.kind === 'recovery-code' && row.secret.usedAt !== undefined,
          ),
        ).toEqual([]);
      },
    });
  });

  it("cannot delete a foreign realm's codes", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subjectId = await seedUser(tx, realmId, 'ada');
        await beginRecoveryCodes(tx, { realmId, subjectId });
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        expect(
          await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code'),
        ).toHaveLength(RECOVERY_CODE_COUNT);
      },
      attempt: async (tx, seeded) =>
        credentialRepository(tx).deleteFor(seeded.subjectId, 'recovery-code'),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        expect(
          await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code'),
        ).toHaveLength(RECOVERY_CODE_COUNT);
      },
    });
  });
});
