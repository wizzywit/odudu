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
import { FakeClock, newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { requiredActionRepository } from '#/repository/required-actions';
import { authenticationSessions, type PendingRequest } from '#/schema/authentication-sessions';
import {
  advance,
  authenticatedSubject,
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

async function seedTenant(
  tx: TenantScopedDatabase,
  tenantId: string,
  otpRequired: boolean,
): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}`, otpRequired });
  await provisionBrowserFlow(tx, tenantId);
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

async function enrol(
  tenantId: string,
  subjectId: string,
  clock: FakeClock,
): Promise<{ secret: string }> {
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginTotpEnrolment(tx, `tenant-${tenantId}`, subjectId),
  );
  const outcome = await withTenant(app.db, tenantId, (tx) =>
    completeTotpEnrolment(
      tx,
      {
        tenantId,
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

function start(tenantId: string, clock: FakeClock): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request, clock);
    return authSessionId;
  });
}

describe('a tenant that requires a second factor collects it as a required action', () => {
  it('authenticates a subject with no credential, and owes them configure-totp', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, true);
      return seedUser(tx, tenantId, 'ada');
    });
    const authSessionId = await start(tenantId, clock);

    // No code is asked for: a subject with nothing enrolled could not
    // produce one, and the flow would park forever if it asked.
    const outcome = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });

    const pending = await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(nextRequiredAction(pending)).toBe('configure-totp');
  });

  it('asks for a code on the next login once the subject has enrolled', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, true);
      return seedUser(tx, tenantId, 'ada');
    });

    const blocked = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, blocked, { username: 'ada', password: PASSWORD }, clock),
    );

    const { secret } = await enrol(tenantId, subjectId, clock);
    // configure-totp is satisfied; what the enrolment leaves behind is the
    // recovery path for the factor it just created.
    const stillOwed = await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(nextRequiredAction(stillOwed)).toBe('generate-recovery-codes');

    // The enrolment's own code is spent by the credential it created, so a
    // step has to pass before the next login can use one (RFC 6238 §5.2).
    clock.advance(31_000);
    const authSessionId = await start(tenantId, clock);
    const challenge = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(challenge).toEqual({ kind: 'challenge', form: 'otp' });

    const completed = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(secret, totpCounter(clock.now())) }, clock),
    );
    expect(completed).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });
  });

  it('refuses the enrolment when the confirming code does not match', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, true);
      return seedUser(tx, tenantId, 'ada');
    });

    const offer = await withTenant(app.db, tenantId, (tx) =>
      beginTotpEnrolment(tx, `tenant-${tenantId}`, subjectId),
    );
    const outcome = await withTenant(app.db, tenantId, (tx) =>
      completeTotpEnrolment(
        tx,
        { tenantId, subjectId, secret: offer.secret, code: '000000' },
        clock,
      ),
    );

    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_code' });
    const stored = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'totp'),
    );
    expect(stored).toEqual([]);
  });

  it('still asks a subject who enrolled before the tenant required it', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return seedUser(tx, tenantId, 'ada');
    });
    await enrol(tenantId, subjectId, clock);
    clock.advance(31_000);

    const authSessionId = await start(tenantId, clock);
    const challenge = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    expect(challenge).toEqual({ kind: 'challenge', form: 'otp' });
  });

  it('asks nobody for a code before anybody has said who they are', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, true);
      return seedUser(tx, tenantId, 'ada');
    });
    await enrol(tenantId, subjectId, clock);

    const challenge = await withTenant(app.db, tenantId, (tx) =>
      initialChallenge(tx, tenantId, clock),
    );

    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });
});

describe('a factor with work left after it is written down, and one that finishes is not', () => {
  it('records password as satisfied when an otp step follows it', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return seedUser(tx, tenantId, 'ada');
    });
    const { secret } = await enrol(tenantId, subjectId, clock);
    clock.advance(31_000);

    const authSessionId = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    // Without this write, the next submission — which carries a code and no
    // password — would find nothing satisfied and be asked for the password
    // all over again.
    const afterPassword = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(afterPassword?.satisfied).toEqual(['password']);
    expect(afterPassword?.subjectId).toBe(subjectId);

    const completed = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(secret, totpCounter(clock.now())) }, clock),
    );
    expect(completed).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });

    // otp finished the login, so it is not written down: a retry after a
    // refusal downstream has to present a code again.
    const afterOtp = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(afterOtp?.satisfied).toEqual(['password']);
  });

  it('re-challenges otp alone after a wrong code, leaving the password satisfied', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return seedUser(tx, tenantId, 'ada');
    });
    const { secret } = await enrol(tenantId, subjectId, clock);
    clock.advance(31_000);

    const authSessionId = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    const wrong = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { code: '000000' }, clock),
    );
    expect(wrong).toEqual({ kind: 'failure', reason: 'invalid_credentials' });

    const still = await withTenant(app.db, tenantId, (tx) =>
      pendingChallenge(tx, authSessionId, clock),
    );
    expect(still).toEqual({ kind: 'challenge', form: 'otp' });

    const completed = await withTenant(app.db, tenantId, (tx) =>
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
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return seedUser(tx, tenantId, 'ada');
    });
    const { secret } = await enrol(tenantId, subjectId, clock);
    clock.advance(31_000);
    const code = totpCode(secret, totpCounter(clock.now()));

    const first = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, first, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(await withTenant(app.db, tenantId, (tx) => advance(tx, first, { code }, clock))).toEqual(
      {
        kind: 'success',
        subjectId,
        authenticators: ['password', 'otp'],
      },
    );

    const second = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, second, { username: 'ada', password: PASSWORD }, clock),
    );
    const replay = await withTenant(app.db, tenantId, (tx) => advance(tx, second, { code }, clock));

    expect(replay).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

// `satisfied` cannot answer "is this login finished": the factor that
// finishes one is deliberately not written down, so a complete attempt and
// one still owing a factor leave identical rows. `authenticated_at` is that
// answer, and it is what a required action is judged against.
describe('a finished authentication is recorded, and stops being recorded', () => {
  it('sets it when the flow runs out of steps and clears it when one reappears', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, true);
      return seedUser(tx, tenantId, 'ada');
    });

    // otp_required with no credential to produce a code: the step cannot
    // apply, so the password finishes this login and the tenant collects the
    // enrolment as a required action instead.
    const authSessionId = await start(tenantId, clock);
    const finished = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(finished).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
    const complete = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(complete?.authenticatedAt).not.toBeNull();
    expect(
      await withTenant(app.db, tenantId, (tx) => authenticatedSubject(tx, authSessionId, clock)),
    ).toBe(subjectId);

    // Completing that required action is what makes the otp step apply, so
    // the same session now owes a factor it did not owe a moment ago. A
    // record of completion that only ever moved one way would still call
    // this attempt finished.
    const { secret } = await enrol(tenantId, subjectId, clock);
    clock.advance(31_000);
    const challenged = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(challenged).toEqual({ kind: 'challenge', form: 'otp' });

    const outstanding = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(outstanding?.authenticatedAt).toBeNull();
    // The predicate the required-action gate reads, not only the column it
    // reads it from: there is nobody to act for while a factor is owed.
    expect(
      await withTenant(app.db, tenantId, (tx) => authenticatedSubject(tx, authSessionId, clock)),
    ).toBeNull();

    // And passing that factor records completion afresh, at the later
    // instant — rewritten on every attempt, not restored to the old stamp.
    clock.advance(31_000);
    const completed = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(secret, totpCounter(clock.now())) }, clock),
    );
    expect(completed).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['password', 'otp'],
    });
    const again = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(again?.authenticatedAt?.getTime()).toBeGreaterThan(
      complete?.authenticatedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  // resetProgress exists for the one refusal whose remedy is somebody else
  // signing in against the same parked request. A finished authentication
  // left behind on that row would be the previous person's, and the gate
  // would act for them.
  it('forgets it when the attempt is put back to how it started', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return seedUser(tx, tenantId, 'ada');
    });

    const authSessionId = await start(tenantId, clock);
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      ),
    ).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
    expect(
      await withTenant(app.db, tenantId, (tx) => authenticatedSubject(tx, authSessionId, clock)),
    ).toBe(subjectId);

    await withTenant(app.db, tenantId, (tx) => resetAuthenticationProgress(tx, authSessionId));

    const cleared = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(cleared?.authenticatedAt).toBeNull();
    expect(cleared?.satisfied).toEqual([]);
    expect(cleared?.subjectId).toBeNull();
    expect(
      await withTenant(app.db, tenantId, (tx) => authenticatedSubject(tx, authSessionId, clock)),
    ).toBeNull();
  });
});

describe('one code, one login', () => {
  it('accepts a code once when two submissions of it race', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return seedUser(tx, tenantId, 'ada');
    });
    const { secret } = await enrol(tenantId, subjectId, clock);
    clock.advance(31_000);
    const code = totpCode(secret, totpCounter(clock.now()));

    // Two attempts, each past its own password step, so the only thing they
    // contend for is the credential's time step.
    const sessions = await Promise.all([start(tenantId, clock), start(tenantId, clock)]);
    for (const authSessionId of sessions) {
      await withTenant(app.db, tenantId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      );
    }

    const outcomes = await Promise.all(
      sessions.map((authSessionId) =>
        withTenant(app.db, tenantId, (tx) => advance(tx, authSessionId, { code }, clock)),
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
    const tenantId = newId();
    const clock = clockAt();
    const { ada, bob } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return { ada: await seedUser(tx, tenantId, 'ada'), bob: await seedUser(tx, tenantId, 'bob') };
    });
    await enrol(tenantId, ada, clock);
    const { secret: bobSecret } = await enrol(tenantId, bob, clock);
    clock.advance(31_000);

    const authSessionId = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    // bob's own valid code, submitted with bob's username, against the
    // attempt ada authenticated: the code is checked against ada's secret,
    // because the subject comes from the attempt and never from the form.
    const hijack = await withTenant(app.db, tenantId, (tx) =>
      advance(
        tx,
        authSessionId,
        { username: 'bob', code: totpCode(bobSecret, totpCounter(clock.now())) },
        clock,
      ),
    );

    expect(hijack).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
    const record = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.subjectId).toBe(ada);
  });

  it('refuses a factor that answers for somebody other than the bound subject', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const { ada, bob } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return { ada: await seedUser(tx, tenantId, 'ada'), bob: await seedUser(tx, tenantId, 'bob') };
    });

    // ada signs in and the login is refused downstream for a reason that
    // leaves the attempt alive (an unverified address), so it stays bound
    // to her. bob then submits his own correct password against it.
    const authSessionId = await start(tenantId, clock);
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
      ),
    ).toMatchObject({ kind: 'success', subjectId: ada });

    const hijack = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'bob', password: PASSWORD }, clock),
    );

    expect(hijack).toEqual({ kind: 'failure', reason: 'subject_mismatch' });
    expect(bob).not.toBe(ada);
  });

  it('lets somebody else sign in once the attempt is put back to how it started', async () => {
    const tenantId = newId();
    const clock = clockAt();
    const { ada, bob } = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId, false);
      return { ada: await seedUser(tx, tenantId, 'ada'), bob: await seedUser(tx, tenantId, 'bob') };
    });
    await enrol(tenantId, ada, clock);
    clock.advance(31_000);

    const authSessionId = await start(tenantId, clock);
    await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );

    await withTenant(app.db, tenantId, (tx) => resetAuthenticationProgress(tx, authSessionId));

    const cleared = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(cleared?.satisfied).toEqual([]);
    expect(cleared?.subjectId).toBeNull();

    const bobsLogin = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'bob', password: PASSWORD }, clock),
    );
    expect(bobsLogin).toEqual({ kind: 'success', subjectId: bob, authenticators: ['password'] });
  });
});

describe('tenantSettingsRepository', () => {
  it("cannot read a foreign tenant's flow settings, and refuses rather than defaulting", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId, true);
        await tx.update(tenants).set({ passwordMaxAgeDays: 90 }).where(eq(tenants.id, tenantId));
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await tenantSettingsRepository(tx).flowSettings(tenantId)).toEqual({
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
      attempt: async (tx, tenantId) => {
        try {
          return await tenantSettingsRepository(tx).flowSettings(tenantId);
        } catch (caught) {
          return caught instanceof OduduError ? caught.code : 'unexpected';
        }
      },
      // Not the off values: a tenant that requires a second factor and a
      // tenant whose row this context cannot see are different things, and
      // answering `false`/`0` for the second would silently drop the factor
      // and switch expiry off.
      expectBlocked: (result) => {
        expect(result).toBe('tenant_not_found');
      },
    });
  });

  // The same proof for the policy the change-password action writes against.
  // Fails closed for a harder reason than the switches above: a default
  // depth of zero would accept a password the tenant remembers, and a
  // default minimum length would accept a weak one.
  it("cannot read a foreign tenant's password policy, and refuses rather than defaulting", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId, false);
        await tx
          .update(tenants)
          .set({ passwordMinLength: 16, passwordHistoryDepth: 3, passwordMaxAgeDays: 90 })
          .where(eq(tenants.id, tenantId));
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await tenantSettingsRepository(tx).passwordPolicy(tenantId)).toMatchObject({
          minLength: 16,
          historyDepth: 3,
          maxAgeDays: 90,
        });
      },
      attempt: async (tx, tenantId) => {
        try {
          return await tenantSettingsRepository(tx).passwordPolicy(tenantId);
        } catch (caught) {
          return caught instanceof OduduError ? caught.code : 'unexpected';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('tenant_not_found');
      },
    });
  });
});

describe('authenticationSessionRepository — the subject binding', () => {
  it('cannot bind a subject under a different tenant context, and leaves the row alone', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId, false);
        const subjectId = await seedUser(tx, tenantId, 'ada');
        const { authSessionId } = await startAuthentication(tx, tenantId, request);
        return { authSessionId, subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.subjectId).toBeNull();
      },
      attempt: async (tx, seeded) =>
        authenticationSessionRepository(tx).bindSubject(seeded.authSessionId, seeded.subjectId),
      expectBlocked: () => {
        // An UPDATE matching zero rows under a foreign tenant context, not a
        // thrown error — the assertion that matters is the one below.
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.subjectId).toBeNull();
      },
    });
  });

  it('cannot clear a foreign tenant’s progress', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId, false);
        const subjectId = await seedUser(tx, tenantId, 'ada');
        const { authSessionId } = await startAuthentication(tx, tenantId, request);
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
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await authenticationSessionRepository(tx).byId(seeded.authSessionId);
        expect(found?.satisfied).toEqual(['password']);
        expect(found?.subjectId).toBe(seeded.subjectId);
      },
    });
  });

  it('refuses a subject from another tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const foreign = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA, false);
      return seedUser(tx, tenantA, 'ada');
    });
    const authSessionId = await withTenant(app.db, tenantB, async (tx) => {
      await seedTenant(tx, tenantB, false);
      return (await startAuthentication(tx, tenantB, request)).authSessionId;
    });

    await expect(
      withTenant(app.db, tenantB, (tx) =>
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
