import { generateTotpSecret, totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareAuthenticator,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { flowRepository } from '#/repository/flows';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { type FlowStep } from '#/schema/flow';
import { advance, startAuthentication } from '#/usecase/executor';
import { beginPasskeyEnrolment, completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes } from '#/usecase/recovery-codes';
import { beginTotpEnrolment, completeTotpEnrolment } from '#/usecase/totp-enrolment';

const SILENT_LOGGER = { error: (): void => undefined };
const PASSWORD = 'correct horse battery staple';
const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';

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

const STRICT: FlowStep[] = [
  { authenticator: 'password', requirement: 'required' },
  {
    authenticator: 'otp',
    requirement: 'required',
    settings: { algorithm: 'SHA256', digits: 8 },
  },
  { authenticator: 'recovery-code', requirement: 'conditional', settings: { count: 12 } },
  {
    authenticator: 'passkey',
    requirement: 'alternative',
    settings: { user_verification: 'discouraged', resident_key: 'preferred' },
  },
];

interface Seeded {
  tenantId: string;
  subjectId: string;
  strictFlow: string;
}

async function seed(): Promise<Seeded> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
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
    const strict = await flowRepository(tx).create(tenantId, 'strict', STRICT);
    return { tenantId, subjectId: subject.id, strictFlow: strict.id };
  });
}

// A sign-in already bound to the subject, on the flow a client names or the
// default when none is.
function startBound(s: Seeded, flowId?: string): Promise<string> {
  return withTenant(app.db, s.tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(
      tx,
      s.tenantId,
      flowId === undefined ? request : { ...request, flowId },
    );
    await authenticationSessionRepository(tx).bindSubject(authSessionId, s.subjectId);
    return authSessionId;
  });
}

async function enrolTotp(s: Seeded, authSessionId: string, clock: FakeClock) {
  const offer = await withTenant(app.db, s.tenantId, (tx) =>
    beginTotpEnrolment(tx, s.tenantId, 'tenant', s.subjectId, authSessionId),
  );
  const params = offer.parameters;
  if (params === undefined) throw new Error('the offer carries no parameters');
  const outcome = await withTenant(app.db, s.tenantId, (tx) =>
    completeTotpEnrolment(
      tx,
      {
        tenantId: s.tenantId,
        subjectId: s.subjectId,
        secret: offer.secret,
        code: totpCode(
          offer.secret,
          totpCounter(clock.now(), params.period),
          params.digits,
          `SHA-${params.algorithm.slice(3)}` as 'SHA-1' | 'SHA-256' | 'SHA-512',
        ),
        authSessionId,
      },
      clock,
    ),
  );
  expect(outcome).toEqual({ kind: 'enrolled' });
  const [row] = await withTenant(app.db, s.tenantId, (tx) =>
    credentialRepository(tx).listFor(s.subjectId, 'totp'),
  );
  return { offer, stored: row?.secret };
}

describe('TOTP enrolment under the flow in force', () => {
  it('uses the step’s digits and algorithm for a client on that flow', async () => {
    const s = await seed();
    const { offer, stored } = await enrolTotp(
      s,
      await startBound(s, s.strictFlow),
      new FakeClock(new Date(Date.UTC(2033, 0, 1))),
    );
    expect(offer.parameters).toEqual({ algorithm: 'SHA256', digits: 8, period: 30 });
    expect(stored).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 30 });
  });

  it('keeps the tenant’s values for a client on the default flow', async () => {
    const s = await seed();
    const { offer, stored } = await enrolTotp(
      s,
      await startBound(s),
      new FakeClock(new Date(Date.UTC(2033, 0, 1))),
    );
    expect(offer.parameters).toEqual({ algorithm: 'SHA1', digits: 6, period: 30 });
    expect(stored).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('uses the default flow’s settings for a client that names no flow', async () => {
    const s = await seed();
    await withTenant(app.db, s.tenantId, (tx) =>
      flowRepository(tx).replaceDefaultSteps(s.tenantId, [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'required', settings: { digits: 8 } },
      ]),
    );
    const { offer, stored } = await enrolTotp(
      s,
      await startBound(s),
      new FakeClock(new Date(Date.UTC(2033, 0, 1))),
    );
    expect(offer.parameters).toEqual({ algorithm: 'SHA1', digits: 8, period: 30 });
    expect(stored).toMatchObject({ digits: 8 });
  });

  it('leaves an enrolment made before the flow was saved verifying as it was made', async () => {
    const s = await seed();
    const clock = new FakeClock(new Date(Date.UTC(2033, 0, 1)));
    const { offer } = await enrolTotp(s, await startBound(s), clock);
    await withTenant(app.db, s.tenantId, (tx) =>
      flowRepository(tx).replaceDefaultSteps(s.tenantId, [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'required', settings: { digits: 8 } },
      ]),
    );

    clock.advance(120_000);
    const authSessionId = await withTenant(app.db, s.tenantId, async (tx) => {
      const started = await startAuthentication(tx, s.tenantId, request, clock);
      return started.authSessionId;
    });
    await withTenant(app.db, s.tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock, {
        logger: SILENT_LOGGER,
      }),
    );
    const outcome = await withTenant(app.db, s.tenantId, (tx) =>
      advance(
        tx,
        authSessionId,
        { code: totpCode(offer.secret, totpCounter(clock.now()), 6, 'SHA-1') },
        clock,
        { logger: SILENT_LOGGER },
      ),
    );
    expect(outcome).toMatchObject({ kind: 'success' });
  });

  it('confirms the enrolment under the parameters it offered when the flow is saved between', async () => {
    const s = await seed();
    const clock = new FakeClock(new Date(Date.UTC(2033, 0, 1)));
    const authSessionId = await startBound(s);
    const offer = await withTenant(app.db, s.tenantId, (tx) =>
      beginTotpEnrolment(tx, s.tenantId, 'tenant', s.subjectId, authSessionId),
    );
    expect(offer.parameters?.digits).toBe(6);
    await withTenant(app.db, s.tenantId, (tx) =>
      flowRepository(tx).replaceDefaultSteps(s.tenantId, [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'required', settings: { digits: 8 } },
      ]),
    );
    const outcome = await withTenant(app.db, s.tenantId, (tx) =>
      completeTotpEnrolment(
        tx,
        {
          tenantId: s.tenantId,
          subjectId: s.subjectId,
          secret: offer.secret,
          code: totpCode(offer.secret, totpCounter(clock.now(), 30), 6, 'SHA-1'),
          authSessionId,
        },
        clock,
      ),
    );
    expect(outcome).toEqual({ kind: 'enrolled' });
    const [row] = await withTenant(app.db, s.tenantId, (tx) =>
      credentialRepository(tx).listFor(s.subjectId, 'totp'),
    );
    expect(row?.secret).toMatchObject({ digits: 6, algorithm: 'SHA1', period: 30 });
  });

  it('ignores a secret no page offered and judges its code by the current policy', async () => {
    const s = await seed();
    const clock = new FakeClock(new Date(Date.UTC(2033, 0, 1)));
    const authSessionId = await startBound(s, s.strictFlow);
    const secret = generateTotpSecret();
    const outcome = await withTenant(app.db, s.tenantId, (tx) =>
      completeTotpEnrolment(
        tx,
        {
          tenantId: s.tenantId,
          subjectId: s.subjectId,
          secret,
          code: totpCode(secret, totpCounter(clock.now(), 30), 6, 'SHA-1'),
          authSessionId,
        },
        clock,
      ),
    );
    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_code' });
  });

  it('falls back to the tenant’s values when the session names no row', async () => {
    const s = await seed();
    const offer = await withTenant(app.db, s.tenantId, (tx) =>
      beginTotpEnrolment(tx, s.tenantId, 'tenant', s.subjectId, newId()),
    );
    expect(offer.parameters).toEqual({ algorithm: 'SHA1', digits: 6, period: 30 });
  });
});

describe('recovery set size under the flow in force', () => {
  const issue = (s: Seeded, authSessionId: string) =>
    withTenant(app.db, s.tenantId, (tx) =>
      beginRecoveryCodes(tx, {
        tenantId: s.tenantId,
        subjectId: s.subjectId,
        authSessionId,
        now: new Date(Date.UTC(2033, 0, 1)),
      }),
    );

  it('issues the step’s count on its flow and the tenant’s on the default', async () => {
    const named = await seed();
    const clock = new FakeClock(new Date(Date.UTC(2033, 0, 1)));
    await enrolTotp(named, await startBound(named), clock);
    const strict = await issue(named, await startBound(named, named.strictFlow));
    expect(strict.kind === 'issued' ? strict.offer.codes : []).toHaveLength(12);

    const plain = await seed();
    await enrolTotp(plain, await startBound(plain), clock);
    const fallback = await issue(plain, await startBound(plain));
    expect(fallback.kind === 'issued' ? fallback.offer.codes : []).toHaveLength(10);
  });
});

describe('passkey registration under the flow in force', () => {
  const offerFor = (s: Seeded, authSessionId: string) =>
    withTenant(app.db, s.tenantId, (tx) =>
      beginPasskeyEnrolment(tx, {
        tenantId: s.tenantId,
        tenantName: 'tenant',
        publicBaseUrl: PUBLIC_BASE_URL,
        authSessionId,
        subjectId: s.subjectId,
      }),
    );

  it('asks for what the step says on its flow and for the tenant’s on the default', async () => {
    const s = await seed();
    const named = await offerFor(s, await startBound(s, s.strictFlow));
    expect(named.options.authenticatorSelection).toMatchObject({
      userVerification: 'discouraged',
      residentKey: 'preferred',
    });
    const fallback = await offerFor(s, await startBound(s));
    expect(fallback.options.authenticatorSelection).toMatchObject({
      userVerification: 'required',
      residentKey: 'required',
    });
  });

  it('verifies an unverified registration only on the flow that does not require verification', async () => {
    const s = await seed();
    const register = async (flowId?: string) => {
      const authSessionId = await startBound(s, flowId);
      const offer = await offerFor(s, authSessionId);
      return withTenant(app.db, s.tenantId, (tx) =>
        completePasskeyEnrolment(tx, {
          tenantId: s.tenantId,
          subjectId: s.subjectId,
          authSessionId,
          publicBaseUrl: PUBLIC_BASE_URL,
          response: softwareAuthenticator().registration({
            challenge: offer.options.challenge,
            rpId: RP_ID,
            origin: PUBLIC_BASE_URL,
            userVerified: false,
          }),
        }),
      );
    };
    expect(await register()).toMatchObject({ kind: 'rejected' });
    expect(await register(s.strictFlow)).toMatchObject({ kind: 'enrolled' });
  });
});
