import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareAuthenticator,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requiredActionRepository } from '#/repository/required-actions';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, initialChallenge, startAuthentication } from '#/usecase/executor';
import { beginPasskeyAuthentication } from '#/usecase/passkey-authentication';
import { completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginTotpEnrolment, completeTotpEnrolment } from '#/usecase/totp-enrolment';

// This suite pins the exact behaviour a default tenant's `BROWSER_FLOW_DEFAULT`
// produced before `required` and `conditional` were split
// (packages/authn-flows/src/service/requirements.ts). Every step in it is
// `alternative` or `conditional`, never `required`, so the split changes
// nothing here by construction — the values below were captured by running
// this same walk against the pre-split code, then pasted in unchanged.

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

const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';
const PASSWORD = 'correct horse battery staple';

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

async function provisionDefaultTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    await provisionBrowserFlow(tx, tenantId);
  });
  return tenantId;
}

async function seedUserWithPassword(tenantId: string, username: string): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
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
  });
}

async function start(tenantId: string): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    return authSessionId;
  });
}

describe('a default tenant login, walked for several subject shapes before and after the split', () => {
  it('offers password first, with nothing submitted', async () => {
    const tenantId = await provisionDefaultTenant();
    const challenge = await withTenant(app.db, tenantId, (tx) => initialChallenge(tx, tenantId));
    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });

  it('logs a password-only subject in with a single factor', async () => {
    const tenantId = await provisionDefaultTenant();
    const subjectId = await seedUserWithPassword(tenantId, 'ada');
    const authSessionId = await start(tenantId);

    const outcome = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }),
    );

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
  });

  it('challenges otp for a subject who has enrolled it, then succeeds with both factors', async () => {
    const tenantId = await provisionDefaultTenant();
    const subjectId = await seedUserWithPassword(tenantId, 'ada');
    const clock = new FakeClock(new Date('2031-01-01T00:00:00.000Z'));
    const offer = await withTenant(app.db, tenantId, (tx) =>
      beginTotpEnrolment(tx, `tenant-${tenantId}`, subjectId),
    );
    const enrolled = await withTenant(app.db, tenantId, (tx) =>
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
    expect(enrolled).toEqual({ kind: 'enrolled' });

    // The enrolment's own code is spent by the credential it just created
    // (RFC 6238 §5.2), so a step has to pass before a login can reuse one.
    clock.advance(31_000);
    const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
      const { authSessionId: id } = await startAuthentication(tx, tenantId, request, clock);
      return id;
    });
    const afterPassword = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, clock),
    );
    expect(afterPassword).toEqual({ kind: 'challenge', form: 'otp' });

    const afterOtp = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { code: totpCode(offer.secret, totpCounter(clock.now())) }, clock),
    );
    expect(afterOtp).toEqual({ kind: 'success', subjectId, authenticators: ['password', 'otp'] });
  });

  it('logs a passkey-only subject in from the assertion alone', async () => {
    const tenantId = await provisionDefaultTenant();
    const authenticator = softwareAuthenticator();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
      await requiredActionRepository(tx).add(tenantId, subject.id, 'configure-passkey');
      const { authSessionId } = await startAuthentication(tx, tenantId, request);
      await authenticationSessionRepository(tx).bindSubject(authSessionId, subject.id);
      await authenticationSessionRepository(tx).setWebauthnChallenge(authSessionId, 'ZW5yb2wtbWU');
      const outcome = await completePasskeyEnrolment(tx, {
        tenantId,
        subjectId: subject.id,
        authSessionId,
        publicBaseUrl: PUBLIC_BASE_URL,
        response: authenticator.registration({
          challenge: 'ZW5yb2wtbWU',
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 0,
        }),
      });
      expect(outcome.kind).toBe('enrolled');
      return subject.id;
    });

    const authSessionId = await start(tenantId);
    const offer = await withTenant(app.db, tenantId, (tx) =>
      beginPasskeyAuthentication(tx, { publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
    );
    const assertion = authenticator.assertion({
      challenge: offer.challenge,
      rpId: RP_ID,
      origin: PUBLIC_BASE_URL,
      signCount: 1,
    });

    const outcome = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { assertion }, undefined, { publicBaseUrl: PUBLIC_BASE_URL }),
    );
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
  });
});
