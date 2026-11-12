import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
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
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes } from '#/usecase/recovery-codes';
import { beginTotpEnrolment, completeTotpEnrolment } from '#/usecase/totp-enrolment';

const SILENT_LOGGER = { error: (): void => undefined };
const PASSWORD = 'correct horse battery staple';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
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
  return new FakeClock(new Date(Date.UTC(2033, 0, 1) + offsetMs));
}

async function seedTenant(tenantId: string): Promise<void> {
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    await provisionBrowserFlow(tx, tenantId);
  });
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

async function setPolicy(tenantId: string, policy: Partial<typeof tenants.$inferInsert>) {
  await owner.db.update(tenants).set(policy).where(eq(tenants.id, tenantId));
}

interface Enrolled {
  secret: string;
  uri: URL;
  at: FakeClock;
}

async function enrol(tenantId: string, subjectId: string, clock: FakeClock): Promise<Enrolled> {
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginTotpEnrolment(tx, tenantId, `tenant-${tenantId}`, subjectId),
  );
  const uri = new URL(offer.uri);
  const digits = Number(uri.searchParams.get('digits'));
  const period = Number(uri.searchParams.get('period'));
  const algorithm = `SHA-${(uri.searchParams.get('algorithm') ?? '').slice(3)}` as
    'SHA-1' | 'SHA-256' | 'SHA-512';
  const outcome = await withTenant(app.db, tenantId, (tx) =>
    completeTotpEnrolment(
      tx,
      {
        tenantId,
        subjectId,
        secret: offer.secret,
        code: totpCode(offer.secret, totpCounter(clock.now(), period), digits, algorithm),
        authSessionId: newId(),
      },
      clock,
    ),
  );
  expect(outcome).toEqual({ kind: 'enrolled' });
  return { secret: offer.secret, uri, at: clock };
}

async function signInWithCode(tenantId: string, username: string, code: string, clock: FakeClock) {
  const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
    const started = await startAuthentication(tx, tenantId, request, clock);
    return started.authSessionId;
  });
  await withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { username, password: PASSWORD }, clock, { logger: SILENT_LOGGER }),
  );
  return withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { code }, clock, { logger: SILENT_LOGGER }),
  );
}

describe('the TOTP policy', () => {
  it('offers and stores today’s parameters to a tenant that never changed them', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    const subjectId = await withTenant(app.db, tenantId, (tx) => seedUser(tx, tenantId, 'ada'));

    const { uri } = await enrol(tenantId, subjectId, clockAt());

    expect(Object.fromEntries(uri.searchParams)).toMatchObject({
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
    const [row] = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'totp'),
    );
    expect(row?.secret).toMatchObject({ kind: 'totp', algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('applies a changed policy to the next enrolment and strands nobody already enrolled', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    const { old, fresh } = await withTenant(app.db, tenantId, async (tx) => ({
      old: await seedUser(tx, tenantId, 'old'),
      fresh: await seedUser(tx, tenantId, 'fresh'),
    }));
    const clock = clockAt();
    const before = await enrol(tenantId, old, clock);

    await setPolicy(tenantId, { totpAlgorithm: 'SHA256', totpDigits: 8, totpPeriod: 60 });
    clock.advance(120_000);
    const after = await enrol(tenantId, fresh, clock);

    expect(Object.fromEntries(after.uri.searchParams)).toMatchObject({
      algorithm: 'SHA256',
      digits: '8',
      period: '60',
    });
    const [freshRow] = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(fresh, 'totp'),
    );
    expect(freshRow?.secret).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 60 });

    clock.advance(120_000);
    const oldSignIn = await signInWithCode(
      tenantId,
      'old',
      totpCode(before.secret, totpCounter(clock.now()), 6, 'SHA-1'),
      clock,
    );
    expect(oldSignIn).toMatchObject({ kind: 'success' });

    clock.advance(120_000);
    const freshSignIn = await signInWithCode(
      tenantId,
      'fresh',
      totpCode(after.secret, totpCounter(clock.now(), 60), 8, 'SHA-256'),
      clock,
    );
    expect(freshSignIn).toMatchObject({ kind: 'success' });
  });

  it('refuses a code made under the tenant’s current policy against an older enrolment', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    const subjectId = await withTenant(app.db, tenantId, (tx) => seedUser(tx, tenantId, 'ada'));
    const clock = clockAt();
    const { secret } = await enrol(tenantId, subjectId, clock);
    await setPolicy(tenantId, { totpAlgorithm: 'SHA512', totpDigits: 8, totpPeriod: 60 });

    clock.advance(120_000);
    const outcome = await signInWithCode(
      tenantId,
      'ada',
      totpCode(secret, totpCounter(clock.now(), 60), 8, 'SHA-512'),
      clock,
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

describe('the recovery code count', () => {
  it('issues a set of the tenant’s size, and leaves a set already issued alone', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    const subjectId = await withTenant(app.db, tenantId, (tx) => seedUser(tx, tenantId, 'ada'));
    const clock = clockAt();
    await enrol(tenantId, subjectId, clock);

    const issue = async (hoursLater: number) =>
      withTenant(app.db, tenantId, (tx) =>
        beginRecoveryCodes(tx, {
          tenantId,
          subjectId,
          now: new Date(clock.now().getTime() + hoursLater * 3_600_000),
        }),
      );
    const first = await issue(2);
    expect(first.kind === 'issued' ? first.offer.codes : []).toHaveLength(10);

    await setPolicy(tenantId, { recoveryCodeCount: 14 });
    const held = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).recoveryStanding(subjectId),
    );
    expect(held).toMatchObject({ held: 10, unspent: 10 });

    const second = await issue(4);
    expect(second.kind === 'issued' ? second.offer.codes : []).toHaveLength(14);
  });
});

describe('tenantSettingsRepository.authenticatorPolicy', () => {
  it('reads the policy of its own tenant and refuses a foreign one rather than defaulting', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({
          id: tenantId,
          name: `tenant-${tenantId}`,
          totpAlgorithm: 'SHA512',
          totpDigits: 8,
          totpPeriod: 60,
          webauthnUserVerification: 'discouraged',
          webauthnResidentKey: 'preferred',
          recoveryCodeCount: 12,
        });
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await tenantSettingsRepository(tx).authenticatorPolicy(tenantId)).toEqual({
          totp: { algorithm: 'SHA512', digits: 8, period: 60 },
          webauthn: { userVerification: 'discouraged', residentKey: 'preferred' },
          recoveryCodeCount: 12,
        });
      },
      attempt: async (tx, tenantId) => {
        try {
          return await tenantSettingsRepository(tx).authenticatorPolicy(tenantId);
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
