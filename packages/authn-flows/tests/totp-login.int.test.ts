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
import { FakeClock, newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { requiredActionRepository } from '#/repository/required-actions';
import { authenticationSessions, type PendingRequest } from '#/schema/authentication-sessions';
import {
  advance,
  initialChallenge,
  pendingChallenge,
  resetAuthenticationProgress,
  startAuthentication,
} from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { nextRequiredAction } from '#/usecase/required-actions';
import { beginTotpEnrolment, completeTotpEnrolment } from '#/usecase/totp-enrolment';

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

// Far enough from any real clock that a step number here can never collide
// with one a previous run of the suite spent.
function clockAt(offsetMs = 0): FakeClock {
  return new FakeClock(new Date(Date.UTC(2031, 0, 1) + offsetMs));
}

async function seedRealm(
  tx: RealmScopedDatabase,
  realmId: string,
  otpRequired: boolean,
): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}`, otpRequired });
  await provisionBrowserFlow(tx, realmId);
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

async function enrol(
  realmId: string,
  subjectId: string,
  clock: FakeClock,
): Promise<{ secret: string }> {
  const offer = await withRealm(app.db, realmId, (tx) =>
    beginTotpEnrolment(tx, `realm-${realmId}`, subjectId),
  );
  const outcome = await withRealm(app.db, realmId, (tx) =>
    completeTotpEnrolment(
      tx,
      {
        realmId,
        subjectId,
        secret: offer.secret,
        code: totpCode(offer.secret, totpCounter(clock.now())),
      },
      clock,
    ),
  );
  expect(outcome).toEqual({ kind: 'enrolled' });
  return { secret: offer.secret };
}

function start(realmId: string, clock: FakeClock): Promise<string> {
  return withRealm(app.db, realmId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, realmId, request, clock);
    return authSessionId;
  });
}

describe('a realm that requires a second factor collects it as a required action', () => {
  it('authenticates a subject with no credential, and owes them configure-totp', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, true);
      return seedUser(tx, realmId, 'ada');
    });
    const authSessionId = await start(realmId, clock);

    // No code is asked for: a subject with nothing enrolled could not
    // produce one, and the flow would park forever if it asked.
    const outcome = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });

    const pending = await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(nextRequiredAction(pending)).toBe('configure-totp');
  });

  it('asks for a code on the next login once the subject has enrolled', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, true);
      return seedUser(tx, realmId, 'ada');
    });

    const blocked = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, blocked, { username: 'ada', password: PASSWORD }, clock),
    );

    const { secret } = await enrol(realmId, subjectId, clock);
    // configure-totp is satisfied; what the enrolment leaves behind is the
    // recovery path for the factor it just created.
    const stillOwed = await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(nextRequiredAction(stillOwed)).toBe('generate-recovery-codes');

    // The enrolment's own code is spent by the credential it created, so a
    // step has to pass before the next login can use one (RFC 6238 §5.2).
    clock.advance(31_000);
    const authSessionId = await start(realmId, clock);
    const challenge = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(challenge).toEqual({ kind: 'challenge', form: 'otp' });

    const completed = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(secret, totpCounter(clock.now())) }, clock),
    );
    expect(completed).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });
  });

  it('refuses the enrolment when the confirming code does not match', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, true);
      return seedUser(tx, realmId, 'ada');
    });

    const offer = await withRealm(app.db, realmId, (tx) =>
      beginTotpEnrolment(tx, `realm-${realmId}`, subjectId),
    );
    const outcome = await withRealm(app.db, realmId, (tx) =>
      completeTotpEnrolment(
        tx,
        { realmId, subjectId, secret: offer.secret, code: '000000' },
        clock,
      ),
    );

    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_code' });
    const stored = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'totp'),
    );
    expect(stored).toEqual([]);
  });

  it('still asks a subject who enrolled before the realm required it', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return seedUser(tx, realmId, 'ada');
    });
    await enrol(realmId, subjectId, clock);
    clock.advance(31_000);

    const authSessionId = await start(realmId, clock);
    const challenge = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    expect(challenge).toEqual({ kind: 'challenge', form: 'otp' });
  });

  it('asks nobody for a code before anybody has said who they are', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, true);
      return seedUser(tx, realmId, 'ada');
    });
    await enrol(realmId, subjectId, clock);

    const challenge = await withRealm(app.db, realmId, (tx) =>
      initialChallenge(tx, realmId, clock),
    );

    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });
});

describe('a factor with work left after it is written down, and one that finishes is not', () => {
  it('records password as satisfied when an otp step follows it', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return seedUser(tx, realmId, 'ada');
    });
    const { secret } = await enrol(realmId, subjectId, clock);
    clock.advance(31_000);

    const authSessionId = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    // Without this write, the next submission — which carries a code and no
    // password — would find nothing satisfied and be asked for the password
    // all over again.
    const afterPassword = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(afterPassword?.satisfied).toEqual(['password']);
    expect(afterPassword?.subjectId).toBe(subjectId);

    const completed = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(secret, totpCounter(clock.now())) }, clock),
    );
    expect(completed).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });

    // otp finished the login, so it is not written down: a retry after a
    // refusal downstream has to present a code again.
    const afterOtp = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(afterOtp?.satisfied).toEqual(['password']);
  });

  it('re-challenges otp alone after a wrong code, leaving the password satisfied', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return seedUser(tx, realmId, 'ada');
    });
    const { secret } = await enrol(realmId, subjectId, clock);
    clock.advance(31_000);

    const authSessionId = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    const wrong = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { code: '000000' }, clock),
    );
    expect(wrong).toEqual({ kind: 'failure', reason: 'invalid_credentials' });

    const still = await withRealm(app.db, realmId, (tx) =>
      pendingChallenge(tx, authSessionId, clock),
    );
    expect(still).toEqual({ kind: 'challenge', form: 'otp' });

    const completed = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(secret, totpCounter(clock.now())) }, clock),
    );
    expect(completed).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });
  });

  // RFC 6238 §5.2: the verifier must not accept an OTP twice. verifyTotp
  // holds half of that; spending the step on the credential is the half
  // this flow owes it.
  it('refuses the same code a second time', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return seedUser(tx, realmId, 'ada');
    });
    const { secret } = await enrol(realmId, subjectId, clock);
    clock.advance(31_000);
    const code = totpCode(secret, totpCounter(clock.now()));

    const first = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, first, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(await withRealm(app.db, realmId, (tx) => advance(tx, first, { code }, clock))).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });

    const second = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, second, { username: 'ada', password: PASSWORD }, clock),
    );
    const replay = await withRealm(app.db, realmId, (tx) => advance(tx, second, { code }, clock));

    expect(replay).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

describe('one code, one login', () => {
  it('accepts a code once when two submissions of it race', async () => {
    const realmId = newId();
    const clock = clockAt();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return seedUser(tx, realmId, 'ada');
    });
    const { secret } = await enrol(realmId, subjectId, clock);
    clock.advance(31_000);
    const code = totpCode(secret, totpCounter(clock.now()));

    // Two attempts, each past its own password step, so the only thing they
    // contend for is the credential's time step.
    const sessions = await Promise.all([start(realmId, clock), start(realmId, clock)]);
    for (const authSessionId of sessions) {
      await withRealm(app.db, realmId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      );
    }

    const outcomes = await Promise.all(
      sessions.map((authSessionId) =>
        withRealm(app.db, realmId, (tx) => advance(tx, authSessionId, { code }, clock)),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.kind === 'success')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'failure')).toEqual([
      { kind: 'failure', reason: 'invalid_credentials' },
    ]);
  });
});

describe('an attempt answers for one subject and no other', () => {
  it("does not complete ada's login with bob's username and bob's code", async () => {
    const realmId = newId();
    const clock = clockAt();
    const { ada, bob } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return { ada: await seedUser(tx, realmId, 'ada'), bob: await seedUser(tx, realmId, 'bob') };
    });
    await enrol(realmId, ada, clock);
    const { secret: bobSecret } = await enrol(realmId, bob, clock);
    clock.advance(31_000);

    const authSessionId = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    // bob's own valid code, submitted with bob's username, against the
    // attempt ada authenticated: the code is checked against ada's secret,
    // because the subject comes from the attempt and never from the form.
    const hijack = await withRealm(app.db, realmId, (tx) =>
      advance(
        tx,
        authSessionId,
        { username: 'bob', code: totpCode(bobSecret, totpCounter(clock.now())) },
        clock,
      ),
    );

    expect(hijack).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
    const record = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.subjectId).toBe(ada);
  });

  it('refuses a factor that answers for somebody other than the bound subject', async () => {
    const realmId = newId();
    const clock = clockAt();
    const { ada, bob } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return { ada: await seedUser(tx, realmId, 'ada'), bob: await seedUser(tx, realmId, 'bob') };
    });

    // ada signs in and the login is refused downstream for a reason that
    // leaves the attempt alive (an unverified address), so it stays bound
    // to her. bob then submits his own correct password against it.
    const authSessionId = await start(realmId, clock);
    expect(
      await withRealm(app.db, realmId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      ),
    ).toMatchObject({ kind: 'success', subjectId: ada });

    const hijack = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'bob', password: PASSWORD }, clock),
    );

    expect(hijack).toEqual({ kind: 'failure', reason: 'subject_mismatch' });
    expect(bob).not.toBe(ada);
  });

  it('lets somebody else sign in once the attempt is put back to how it started', async () => {
    const realmId = newId();
    const clock = clockAt();
    const { ada, bob } = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId, false);
      return { ada: await seedUser(tx, realmId, 'ada'), bob: await seedUser(tx, realmId, 'bob') };
    });
    await enrol(realmId, ada, clock);
    clock.advance(31_000);

    const authSessionId = await start(realmId, clock);
    await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    await withRealm(app.db, realmId, (tx) => resetAuthenticationProgress(tx, authSessionId));

    const cleared = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(cleared?.satisfied).toEqual([]);
    expect(cleared?.subjectId).toBeNull();

    const bobsLogin = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'bob', password: PASSWORD }, clock),
    );
    expect(bobsLogin).toEqual({ kind: 'success', subjectId: bob, authenticators: ['password'] });
  });
});

describe('realmSettingsRepository', () => {
  it("cannot read a foreign realm's flow settings, and refuses rather than defaulting", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId, true);
        await tx.update(realms).set({ passwordMaxAgeDays: 90 }).where(eq(realms.id, realmId));
        return realmId;
      },
      verifySeeded: async (tx, realmId) => {
        expect(await realmSettingsRepository(tx).flowSettings(realmId)).toEqual({
          otpRequired: true,
          passwordMaxAgeDays: 90,
          lockout: {
            maxFailures: 5,
            lockoutSeconds: 60,
            maxLockoutSeconds: 900,
            failureResetSeconds: 43_200,
          },
        });
      },
      attempt: async (tx, realmId) => {
        try {
          return await realmSettingsRepository(tx).flowSettings(realmId);
        } catch (caught) {
          return caught instanceof OduduError ? caught.code : 'unexpected';
        }
      },
      // Not the off values: a realm that requires a second factor and a
      // realm whose row this context cannot see are different things, and
      // answering `false`/`0` for the second would silently drop the factor
      // and switch expiry off.
      expectBlocked: (result) => {
        expect(result).toBe('realm_not_found');
      },
    });
  });

  // The same proof for the policy the change-password action writes against.
  // Fails closed for a harder reason than the switches above: a default
  // depth of zero would accept a password the realm remembers, and a
  // default minimum length would accept a weak one.
  it("cannot read a foreign realm's password policy, and refuses rather than defaulting", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId, false);
        await tx
          .update(realms)
          .set({ passwordMinLength: 16, passwordHistoryDepth: 3, passwordMaxAgeDays: 90 })
          .where(eq(realms.id, realmId));
        return realmId;
      },
      verifySeeded: async (tx, realmId) => {
        expect(await realmSettingsRepository(tx).passwordPolicy(realmId)).toMatchObject({
          minLength: 16,
          historyDepth: 3,
          maxAgeDays: 90,
        });
      },
      attempt: async (tx, realmId) => {
        try {
          return await realmSettingsRepository(tx).passwordPolicy(realmId);
        } catch (caught) {
          return caught instanceof OduduError ? caught.code : 'unexpected';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('realm_not_found');
      },
    });
  });
});

describe('authenticationSessionRepository — the subject binding', () => {
  it('cannot bind a subject under a different realm context, and leaves the row alone', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId, false);
        const subjectId = await seedUser(tx, realmId, 'ada');
        const { authSessionId } = await startAuthentication(tx, realmId, request);
        return { authSessionId, subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.subjectId).toBeNull();
      },
      attempt: async (tx, seeded) =>
        authenticationSessionRepository(tx).bindSubject(seeded.authSessionId, seeded.subjectId),
      expectBlocked: () => {
        // An UPDATE matching zero rows under a foreign realm context, not a
        // thrown error — the assertion that matters is the one below.
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.subjectId).toBeNull();
      },
    });
  });

  it('cannot clear a foreign realm’s progress', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId, false);
        const subjectId = await seedUser(tx, realmId, 'ada');
        const { authSessionId } = await startAuthentication(tx, realmId, request);
        const repository = authenticationSessionRepository(tx);
        await repository.recordSatisfied(authSessionId, 'password');
        await repository.bindSubject(authSessionId, subjectId);
        return { authSessionId, subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.satisfied).toEqual(['password']);
        expect(found?.subjectId).toBe(seeded.subjectId);
      },
      attempt: async (tx, seeded) =>
        authenticationSessionRepository(tx).resetProgress(seeded.authSessionId),
      expectBlocked: () => {
        // Same shape as bindSubject above: zero rows, no error.
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.satisfied).toEqual(['password']);
        expect(found?.subjectId).toBe(seeded.subjectId);
      },
    });
  });

  it('refuses a subject from another realm', async () => {
    const realmA = newId();
    const realmB = newId();
    const foreign = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA, false);
      return seedUser(tx, realmA, 'ada');
    });
    const authSessionId = await withRealm(app.db, realmB, async (tx) => {
      await seedRealm(tx, realmB, false);
      return (await startAuthentication(tx, realmB, request)).authSessionId;
    });

    await expect(
      withRealm(app.db, realmB, (tx) =>
        authenticationSessionRepository(tx).bindSubject(authSessionId, foreign),
      ),
    ).rejects.toThrow();

    const rows = await owner.db
      .select()
      .from(authenticationSessions)
      .where(eq(authenticationSessions.id, authSessionId));
    expect(rows[0]?.subjectId).toBeNull();
  });
});
