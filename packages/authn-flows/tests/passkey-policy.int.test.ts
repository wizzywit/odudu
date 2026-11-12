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
  type SoftwareAuthenticator,
  type TestDatabase,
} from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication } from '#/usecase/executor';
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

async function seedTenant(
  tenantId: string,
  values: Partial<typeof tenants.$inferInsert> = {},
): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}`, ...values });
    await provisionBrowserFlow(tx, tenantId);
    return seedUser(tx, tenantId);
  });
}

function setPolicy(tenantId: string, values: Partial<typeof tenants.$inferInsert>) {
  return owner.db.update(tenants).set(values).where(eq(tenants.id, tenantId));
}

// Enrols through the same begin and complete the enrolment page calls, so
// the row carries what the policy of that moment made of it.
async function enrolPasskey(
  tenantId: string,
  subjectId: string,
  authenticator: SoftwareAuthenticator,
  userVerified: boolean,
) {
  return withTenant(app.db, tenantId, async (tx) => {
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
        userVerified,
      }),
    });
    return { offer, outcome };
  });
}

async function signInWithPasskey(
  tenantId: string,
  authenticator: SoftwareAuthenticator,
  signCount: number,
  userVerified: boolean,
) {
  const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
    const started = await startAuthentication(tx, tenantId, request);
    return started.authSessionId;
  });
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginPasskeyAuthentication(tx, { tenantId, publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
  );
  const assertion = authenticator.assertion({
    challenge: offer.challenge,
    rpId: RP_ID,
    origin: PUBLIC_BASE_URL,
    signCount,
    userVerified,
  });
  const outcome = await withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { assertion }, undefined, {
      logger: SILENT_LOGGER,
      publicBaseUrl: PUBLIC_BASE_URL,
    }),
  );
  return { offer, outcome };
}

describe('a passkey enrolled under the tenant’s policy', () => {
  it('asks for and stores what the tenant requires, and keeps it through a policy change', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, {
      webauthnUserVerification: 'preferred',
      webauthnResidentKey: 'preferred',
    });
    const authenticator = softwareAuthenticator();

    const { offer, outcome } = await enrolPasskey(tenantId, subjectId, authenticator, false);

    expect(offer.options.authenticatorSelection).toMatchObject({
      userVerification: 'preferred',
      residentKey: 'preferred',
    });
    expect(outcome.kind).toBe('enrolled');
    await setPolicy(tenantId, {
      webauthnUserVerification: 'required',
      webauthnResidentKey: 'required',
    });
    const [row] = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'webauthn'),
    );
    expect(row?.secret).toMatchObject({ userVerification: 'preferred', residentKey: 'preferred' });
  });

  it('refuses a registration without verification under a policy that requires it', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const { outcome } = await enrolPasskey(tenantId, subjectId, softwareAuthenticator(), false);
    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_response' });
  });

  it('still signs in after the tenant relaxes its policy', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const authenticator = softwareAuthenticator();
    await enrolPasskey(tenantId, subjectId, authenticator, true);
    await setPolicy(tenantId, { webauthnUserVerification: 'discouraged' });

    const { outcome } = await signInWithPasskey(tenantId, authenticator, 1, true);

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
  });

  it('refuses an unverified assertion from a passkey made when verification was required', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const authenticator = softwareAuthenticator();
    await enrolPasskey(tenantId, subjectId, authenticator, true);
    await setPolicy(tenantId, { webauthnUserVerification: 'discouraged' });

    const { outcome } = await signInWithPasskey(tenantId, authenticator, 1, false);

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

describe('a passkey that did not verify the person', () => {
  async function seedWeakPasskey(otpRequired: boolean) {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, {
      otpRequired,
      webauthnUserVerification: 'preferred',
    });
    const authenticator = softwareAuthenticator();
    await enrolPasskey(tenantId, subjectId, authenticator, false);
    return { tenantId, subjectId, authenticator };
  }

  it('signs in as one factor and leaves the tenant’s second factor owed', async () => {
    const { tenantId, subjectId, authenticator } = await seedWeakPasskey(true);

    const { outcome } = await signInWithPasskey(tenantId, authenticator, 1, false);

    expect(outcome).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['passkey', 'passkey-unverified'],
    });
    const owed = await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(owed).toContain('configure-totp');
  });

  it('is a two-factor sign-in when the same passkey does verify the person', async () => {
    const { tenantId, subjectId, authenticator } = await seedWeakPasskey(true);

    const { outcome } = await signInWithPasskey(tenantId, authenticator, 1, true);

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
  });
});
