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
import { newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareAuthenticator,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { sessionRepository } from '#/repository/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, establishSession, startAuthentication } from '#/usecase/executor';
import { beginPasskeyAuthentication } from '#/usecase/passkey-authentication';
import { beginPasskeyEnrolment, completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

const SILENT_LOGGER = { error: (): void => undefined };
const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';
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

async function seedUser(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
  await tx.insert(userCredentials).values({
    id: newId(),
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secretData: { hash: await hashPassword(PASSWORD) },
  });
  return subject.id;
}

async function seedTenant(tenantId: string, requirePasskey: boolean): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}`, requirePasskey });
    await provisionBrowserFlow(tx, tenantId);
    return seedUser(tx, tenantId);
  });
}

function setSwitch(tenantId: string, requirePasskey: boolean) {
  return owner.db.update(tenants).set({ requirePasskey }).where(eq(tenants.id, tenantId));
}

async function pendingOf(tenantId: string, subjectId: string) {
  return withTenant(app.db, tenantId, (tx) => requiredActionRepository(tx).pendingFor(subjectId));
}

async function passwordSignIn(tenantId: string, publicBaseUrl: string | undefined) {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    return advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, undefined, {
      logger: SILENT_LOGGER,
      ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
    });
  });
}

async function enrolPasskey(tenantId: string, subjectId: string) {
  const authenticator = softwareAuthenticator();
  await withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    await authenticationSessionRepository(tx).bindSubject(authSessionId, subjectId);
    const offer = await beginPasskeyEnrolment(tx, {
      tenantId,
      tenantName: `tenant-${tenantId}`,
      publicBaseUrl: PUBLIC_BASE_URL,
      authSessionId,
      subjectId,
    });
    const outcome = await completePasskeyEnrolment(tx, {
      tenantId,
      subjectId,
      authSessionId,
      publicBaseUrl: PUBLIC_BASE_URL,
      response: authenticator.registration({
        challenge: offer.options.challenge,
        rpId: RP_ID,
        origin: PUBLIC_BASE_URL,
        userVerified: true,
      }),
    });
    expect(outcome.kind).toBe('enrolled');
  });
  return authenticator;
}

describe('the passkey switch', () => {
  it('owes a person without a passkey the enrolment at the next sign-in, and not before', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, false);
    const { sessionId } = await withTenant(app.db, tenantId, (tx) =>
      establishSession(tx, tenantId, subjectId, 36_000, ['password']),
    );

    await setSwitch(tenantId, true);

    expect(await pendingOf(tenantId, subjectId)).toEqual([]);
    const open = await withTenant(app.db, tenantId, (tx) => sessionRepository(tx).byId(sessionId));
    expect(open?.subjectId).toBe(subjectId);
    expect(open?.authenticators).toEqual(['password']);

    const outcome = await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(outcome.kind).toBe('success');
    expect(await pendingOf(tenantId, subjectId)).toEqual(['configure-passkey']);
  });

  it('owes it once however often the person signs in', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, true);
    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(await pendingOf(tenantId, subjectId)).toEqual(['configure-passkey']);
  });

  it('owes nothing to a person who holds a passkey, and owes it again once it is removed', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, true);
    await enrolPasskey(tenantId, subjectId);

    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(await pendingOf(tenantId, subjectId)).toEqual([]);

    await withTenant(app.db, tenantId, async (tx) => {
      const [passkey] = await credentialRepository(tx).listFor(subjectId, 'webauthn');
      if (passkey === undefined) throw new Error('expected the enrolled passkey');
      await credentialRepository(tx).deleteOne(passkey.id);
    });
    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(await pendingOf(tenantId, subjectId)).toEqual(['configure-passkey']);
  });

  it('owes the enrolment to a person whose passkey belongs to another address, which no sign-in here offers', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, true);
    await enrolPasskey(tenantId, subjectId);
    await owner.db
      .update(userCredentials)
      .set({ rpId: 'old.example.org' })
      .where(eq(userCredentials.subjectId, subjectId));
    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(await pendingOf(tenantId, subjectId)).toEqual(['configure-passkey']);
  });

  it('owes nothing when the person signs in with the passkey they hold', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, true);
    const authenticator = await enrolPasskey(tenantId, subjectId);
    const outcome = await withTenant(app.db, tenantId, async (tx) => {
      const { authSessionId } = await startAuthentication(tx, tenantId, request);
      const offer = await beginPasskeyAuthentication(tx, {
        tenantId,
        publicBaseUrl: PUBLIC_BASE_URL,
        authSessionId,
      });
      return advance(
        tx,
        authSessionId,
        {
          assertion: authenticator.assertion({
            challenge: offer.challenge,
            rpId: RP_ID,
            origin: PUBLIC_BASE_URL,
            signCount: 5,
            userVerified: true,
          }),
        },
        undefined,
        { logger: SILENT_LOGGER, publicBaseUrl: PUBLIC_BASE_URL },
      );
    });
    expect(outcome.kind).toBe('success');
    expect(await pendingOf(tenantId, subjectId)).toEqual([]);
  });

  it('adds nothing with the switch off, and leaves an action already owed until it is done', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, true);
    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    await setSwitch(tenantId, false);

    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(await pendingOf(tenantId, subjectId)).toEqual(['configure-passkey']);

    await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).complete(subjectId, 'configure-passkey'),
    );
    await passwordSignIn(tenantId, PUBLIC_BASE_URL);
    expect(await pendingOf(tenantId, subjectId)).toEqual([]);
  });

  it('owes nothing where the deployment cannot show the enrolment page', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, true);
    const outcome = await passwordSignIn(tenantId, undefined);
    expect(outcome.kind).toBe('success');
    expect(await pendingOf(tenantId, subjectId)).toEqual([]);
  });

  it("never reaches another tenant's people", async () => {
    const mine = newId();
    const other = newId();
    await seedTenant(mine, true);
    const otherSubject = await seedTenant(other, false);
    await passwordSignIn(mine, PUBLIC_BASE_URL);
    expect(await pendingOf(other, otherSubject)).toEqual([]);
  });
});
