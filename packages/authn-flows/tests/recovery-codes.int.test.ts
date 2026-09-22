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
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
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
import {
  beginRecoveryCodes,
  completeRecoveryCodes,
  oweRecoveryCodesIfNoneUnspent,
} from '#/usecase/recovery-codes';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionBrowserFlow(tx, tenantId);
}

// Any valid base32 secret: no test here ever computes a code from it. What
// it buys is a subject the OTP step applies to, which is the only state a
// recovery code has anything to stand in for.
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

async function enrolTotp(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
  clock: FakeClock,
): Promise<void> {
  const outcome = await completeTotpEnrolment(
    tx,
    {
      tenantId,
      subjectId,
      secret: TOTP_SECRET,
      code: totpCode(TOTP_SECRET, totpCounter(clock.now())),
    },
    clock,
  );
  expect(outcome).toEqual({ kind: 'enrolled' });
}

async function seedUser(
  tx: TenantScopedDatabase,
  tenantId: string,
  username: string,
): Promise<string> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
  await tx.insert(userCredentials).values({
    id: newId(),
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secretData: { hash: await hashPassword(PASSWORD) },
  });
  return subject.id;
}

interface Account {
  tenantId: string;
  subjectId: string;
  codes: readonly string[];
}

// A subject with a second factor enrolled and a set of recovery codes: the
// state this whole feature exists for, since a recovery code substitutes
// for a factor that has to be in play for anything to substitute for.
async function seedAccountWithCodes(clock: FakeClock, username = 'ada'): Promise<Account> {
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId);
    const subject = await seedUser(tx, tenantId, username);
    await enrolTotp(tx, tenantId, subject, clock);
    return subject;
  });
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginRecoveryCodes(tx, { tenantId, subjectId }),
  );
  return { tenantId, subjectId, codes: offer.codes };
}

function start(tenantId: string, clock: FakeClock): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request, clock);
    return authSessionId;
  });
}

async function signInWithPassword(
  tenantId: string,
  clock: FakeClock,
  username = 'ada',
): Promise<string> {
  const authSessionId = await start(tenantId, clock);
  await withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { username, password: PASSWORD }, clock),
  );
  return authSessionId;
}

function present(
  tenantId: string,
  authSessionId: string,
  recoveryCode: string,
  clock: FakeClock,
): Promise<AdvanceOutcome> {
  return withTenant(app.db, tenantId, (tx) => advance(tx, authSessionId, { recoveryCode }, clock));
}

function storedCodes(
  account: Account,
): Promise<{ usedAt: string | undefined; lastUsedAt: Date | null }[]> {
  return withTenant(app.db, account.tenantId, async (tx) => {
    const rows = await credentialRepository(tx).listFor(account.subjectId, 'recovery-code');
    return rows.map((row) => ({
      usedAt: row.secret.kind === 'recovery-code' ? row.secret.usedAt : undefined,
      lastUsedAt: row.lastUsedAt,
    }));
  });
}

// Spends rows straight through the repository, bypassing the flow. Used to
// set a subject up near exhaustion: driving every earlier code through a
// real login costs an Argon2id verification per code tried and proves
// nothing the first spend has not already proven.
async function spendDirectly(account: Account, count: number): Promise<void> {
  await withTenant(app.db, account.tenantId, async (tx) => {
    const rows = await credentialRepository(tx).listFor(account.subjectId, 'recovery-code');
    for (const row of rows.slice(0, count)) {
      expect(await credentialRepository(tx).spendRecoveryCode(row.id, new Date())).toBe(true);
    }
  });
}

// What the subject does after saving a set: the seeded enrolment owes the
// action, and nothing in these tests goes through the page that clears it.
function acknowledge(account: Account): Promise<void> {
  return withTenant(app.db, account.tenantId, (tx) =>
    requiredActionRepository(tx).complete(account.subjectId, 'generate-recovery-codes'),
  );
}

function pendingActions(account: Account): Promise<string[]> {
  return withTenant(app.db, account.tenantId, (tx) =>
    requiredActionRepository(tx).pendingFor(account.subjectId),
  );
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
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
      code ?? '',
      clock,
    );
    expect(first).toEqual({
      kind: 'success',
      subjectId: account.subjectId,
      authenticators: ['password', 'recovery-code'],
    });

    const again = await present(
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
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
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
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
        account.tenantId,
        await signInWithPassword(account.tenantId, clock),
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
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
      'ZZZZZ-ZZZZZ',
      clock,
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('replaces the whole set when a subject generates again, invalidating the old ten', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);

    const reissued = await withTenant(app.db, account.tenantId, (tx) =>
      beginRecoveryCodes(tx, { tenantId: account.tenantId, subjectId: account.subjectId }),
    );
    expect(reissued.replaced).toBe(true);
    expect(await storedCodes(account)).toHaveLength(RECOVERY_CODE_COUNT);

    const old = await present(
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
      account.codes[0] ?? '',
      clock,
    );
    expect(old).toEqual({ kind: 'failure', reason: 'invalid_credentials' });

    const fresh = await present(
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
      reissued.codes[0] ?? '',
      clock,
    );
    expect(fresh).toMatchObject({ kind: 'success', subjectId: account.subjectId });
  });

  it("does not authenticate one subject with another's code from the same tenant", async () => {
    const clock = clockAt();
    const ada = await seedAccountWithCodes(clock, 'ada');
    const bob = await withTenant(app.db, ada.tenantId, (tx) => seedUser(tx, ada.tenantId, 'bob'));
    const bobsCodes = await withTenant(app.db, ada.tenantId, (tx) =>
      beginRecoveryCodes(tx, { tenantId: ada.tenantId, subjectId: bob }),
    );

    // ada's attempt, bob's own valid code: the codes are read for the
    // subject the attempt is bound to, so bob's list is never consulted.
    const outcome = await present(
      ada.tenantId,
      await signInWithPassword(ada.tenantId, clock, 'ada'),
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
  // Both transactions are open and inside advance() before either reaches
  // the UPDATE, rather than overlapping because argon2 happens to be slow:
  // the barrier makes "genuinely concurrent" a property of the test. The
  // UPDATE's own predicate on usedAt is then the decision, so the second
  // serializes on the row and finds nothing to update — a read-then-write
  // pair would let both through.
  it('accepts a code once when two concurrent submissions present it', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    const code = account.codes[0] ?? '';

    const sessions = await Promise.all([
      signInWithPassword(account.tenantId, clock),
      signInWithPassword(account.tenantId, clock),
    ]);

    let arrived = 0;
    let bothOpen: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      bothOpen = resolve;
    });
    const arrive = async (): Promise<void> => {
      arrived += 1;
      if (arrived === sessions.length) bothOpen();
      await barrier;
    };

    const outcomes = await Promise.all(
      sessions.map((authSessionId) =>
        withTenant(app.db, account.tenantId, async (tx) => {
          await arrive();
          return advance(tx, authSessionId, { recoveryCode: code }, clock);
        }),
      ),
    );

    expect(arrived).toBe(2);
    expect(outcomes.filter((outcome) => outcome.kind === 'success')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'failure')).toEqual([
      { kind: 'failure', reason: 'invalid_credentials' },
    ]);
    expect((await storedCodes(account)).filter((row) => row.usedAt !== undefined)).toHaveLength(1);
  });
});

describe('the second-factor form offers both, and the recovery code wins the step', () => {
  it('asks for a code from the app until a recovery code is actually submitted', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return seedUser(tx, tenantId, 'ada');
    });
    // A TOTP credential, so the OTP step is the one that would otherwise run.
    await withTenant(app.db, tenantId, (tx) => enrolTotp(tx, tenantId, subjectId, clock));

    const authSessionId = await start(tenantId, clock);
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      ),
    ).toEqual({ kind: 'challenge', form: 'otp' });
    expect(
      await withTenant(app.db, tenantId, (tx) => pendingChallenge(tx, authSessionId, clock)),
    ).toEqual({ kind: 'challenge', form: 'otp' });

    // Fresh codes: the enrolment above owed a set, and asking for them is
    // what a subject who has just lost the authenticator would have done.
    const offer = await withTenant(app.db, tenantId, (tx) =>
      beginRecoveryCodes(tx, { tenantId, subjectId }),
    );
    const outcome = await withTenant(app.db, tenantId, (tx) =>
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
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await seedUser(tx, tenantId, 'ada');
      await enrolTotp(tx, tenantId, subject, clock);
      return subject;
    });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'recovery-code'),
      ),
    ).toEqual([]);

    const authSessionId = await signInWithPassword(tenantId, clock);
    const outcome = await present(tenantId, authSessionId, 'A', clock);

    expect(outcome).toEqual({ kind: 'challenge', form: 'otp' });
  });

  it('challenges for a code when the tenant has no recovery step, even for a code it would accept', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    await withTenant(app.db, account.tenantId, (tx) =>
      tx
        .delete(authenticationExecutions)
        .where(eq(authenticationExecutions.authenticator, 'recovery-code')),
    );

    const authSessionId = await signInWithPassword(account.tenantId, clock);
    const outcome = await present(account.tenantId, authSessionId, account.codes[0] ?? '', clock);

    expect(outcome).toEqual({ kind: 'challenge', form: 'otp' });
    // Nothing was spent: the step the code would have answered never ran.
    expect((await storedCodes(account)).filter((row) => row.usedAt !== undefined)).toEqual([]);
  });
});

describe('enrolling a second factor asks for a recovery path', () => {
  it('owes generate-recovery-codes to a subject who has just enrolled TOTP', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return seedUser(tx, tenantId, 'ada');
    });

    await withTenant(app.db, tenantId, (tx) => enrolTotp(tx, tenantId, subjectId, clock));

    const pending = await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(pending).toContain('generate-recovery-codes');
  });

  // A second factor does not invalidate a list the subject has already
  // saved, and re-issuing would silently retire the copy on their paper.
  it('does not ask a subject who already holds codes', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await seedUser(tx, tenantId, 'ada');
      await beginRecoveryCodes(tx, { tenantId, subjectId: subject });
      return subject;
    });

    await withTenant(app.db, tenantId, (tx) => enrolTotp(tx, tenantId, subjectId, clock));

    const pending = await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(pending).not.toContain('generate-recovery-codes');
  });

  // Keycloak re-presents the setup as the last code is spent, and the
  // alternative is a dead end: nothing else in the server owes the action,
  // so a subject who ran out would need an operator to delete the rows.
  it('owes a fresh set when the last code is spent, and not when one remains', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    // Seeding enrols TOTP, which owes the action; the subject then saved the
    // codes it issued. Without acknowledging that, the assertions below would
    // pass on a row nothing in this test put there.
    await acknowledge(account);
    expect(await pendingActions(account)).not.toContain('generate-recovery-codes');
    await spendDirectly(account, RECOVERY_CODE_COUNT - 2);

    const [ninth, tenth] = account.codes.slice(-2);
    const penultimate = await present(
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
      ninth ?? '',
      clock,
    );
    expect(penultimate.kind).toBe('success');
    expect(await pendingActions(account)).not.toContain('generate-recovery-codes');

    const last = await present(
      account.tenantId,
      await signInWithPassword(account.tenantId, clock),
      tenth ?? '',
      clock,
    );
    expect(last.kind).toBe('success');
    expect(await pendingActions(account)).toContain('generate-recovery-codes');
  });

  // The spent rows are still rows, so a guard that counted them would find
  // ten and stay quiet — which is how spending the last code came to owe
  // nothing at all.
  it('asks a subject whose whole set is spent, on the next enrolment', async () => {
    const clock = clockAt();
    const account = await seedAccountWithCodes(clock);
    await spendDirectly(account, RECOVERY_CODE_COUNT);
    await acknowledge(account);

    await withTenant(app.db, account.tenantId, (tx) =>
      oweRecoveryCodesIfNoneUnspent(tx, account.tenantId, account.subjectId),
    );

    expect(await pendingActions(account)).toContain('generate-recovery-codes');
  });

  it('completes the action on acknowledgement, and refuses one with no codes stored', async () => {
    const account = await seedAccountWithCodes(clockAt());
    await withTenant(app.db, account.tenantId, (tx) =>
      requiredActionRepository(tx).add(
        account.tenantId,
        account.subjectId,
        'generate-recovery-codes',
      ),
    );

    expect(
      await withTenant(app.db, account.tenantId, (tx) =>
        completeRecoveryCodes(tx, { subjectId: account.subjectId }),
      ),
    ).toEqual({ kind: 'acknowledged' });
    expect(
      await withTenant(app.db, account.tenantId, (tx) =>
        requiredActionRepository(tx).pendingFor(account.subjectId),
      ),
    ).not.toContain('generate-recovery-codes');

    const bare = await withTenant(app.db, account.tenantId, async (tx) => {
      const subjectId = await seedUser(tx, account.tenantId, 'bare');
      return completeRecoveryCodes(tx, { subjectId });
    });
    expect(bare).toEqual({ kind: 'rejected', reason: 'none_issued' });
  });
});

describe('credentialRepository — the recovery-code writes', () => {
  it('cannot spend a code under a different tenant context, and leaves the row alone', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subjectId = await seedUser(tx, tenantId, 'ada');
        await beginRecoveryCodes(tx, { tenantId, subjectId });
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
      verifyTenantAUnaffected: async (tx, seeded) => {
        const rows = await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code');
        expect(
          rows.filter(
            (row) => row.secret.kind === 'recovery-code' && row.secret.usedAt !== undefined,
          ),
        ).toEqual([]);
      },
    });
  });

  it('counts no unspent codes under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subjectId = await seedUser(tx, tenantId, 'ada');
        await beginRecoveryCodes(tx, { tenantId, subjectId });
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await credentialRepository(tx).countUnspentRecoveryCodes(seeded.subjectId)).toBe(
          RECOVERY_CODE_COUNT,
        );
      },
      attempt: async (tx, seeded) =>
        credentialRepository(tx).countUnspentRecoveryCodes(seeded.subjectId),
      expectBlocked: (result) => {
        // Zero is the answer a foreign tenant gets, and it is the answer that
        // would owe a fresh set — so the guard that reads it is only safe
        // because nothing calls it outside the subject's own tenant context.
        expect(result).toBe(0);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect(await credentialRepository(tx).countUnspentRecoveryCodes(seeded.subjectId)).toBe(
          RECOVERY_CODE_COUNT,
        );
      },
    });
  });

  it("cannot delete a foreign tenant's codes", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subjectId = await seedUser(tx, tenantId, 'ada');
        await beginRecoveryCodes(tx, { tenantId, subjectId });
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        expect(
          await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code'),
        ).toHaveLength(RECOVERY_CODE_COUNT);
      },
      attempt: async (tx, seeded) => credentialRepository(tx).deleteRecoveryCodes(seeded.subjectId),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect(
          await credentialRepository(tx).listFor(seeded.subjectId, 'recovery-code'),
        ).toHaveLength(RECOVERY_CODE_COUNT);
      },
    });
  });
});
