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
import { auditRepository } from '@odudu/domain-audit';
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
  discoverable?: boolean,
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
        ...(discoverable === undefined ? {} : { discoverable }),
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

  it('still refuses it when the tenant has since moved to required', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const authenticator = softwareAuthenticator();
    await enrolPasskey(tenantId, subjectId, authenticator, true);
    await setPolicy(tenantId, { webauthnUserVerification: 'required' });

    const { offer, outcome } = await signInWithPasskey(tenantId, authenticator, 1, false);

    expect(offer.options.userVerification).toBe('preferred');
    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('lets a passkey made under preferred answer after the tenant moves to required', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId, { webauthnUserVerification: 'preferred' });
    const authenticator = softwareAuthenticator();
    await enrolPasskey(tenantId, subjectId, authenticator, false);
    await setPolicy(tenantId, { webauthnUserVerification: 'required' });

    const { offer, outcome } = await signInWithPasskey(tenantId, authenticator, 1, false);

    expect(offer.options.userVerification).toBe('preferred');
    expect(outcome).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['passkey', 'passkey-unverified'],
    });
  });
});

describe('a passkey that cannot be discovered', () => {
  it.each(['required', 'preferred', 'discouraged'] as const)(
    'is refused at enrolment under resident key %s, and nothing is stored',
    async (webauthnResidentKey) => {
      const tenantId = newId();
      const subjectId = await seedTenant(tenantId, {
        webauthnResidentKey,
        webauthnUserVerification: 'preferred',
      });

      const { outcome } = await enrolPasskey(
        tenantId,
        subjectId,
        softwareAuthenticator(),
        true,
        false,
      );

      expect(outcome).toEqual({ kind: 'rejected', reason: 'not_discoverable' });
      const rows = await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'webauthn'),
      );
      expect(rows).toEqual([]);
    },
  );

  it('is accepted when the client reports it discoverable or reports nothing', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);

    const reported = await enrolPasskey(tenantId, subjectId, softwareAuthenticator(), true, true);
    const silent = await enrolPasskey(tenantId, subjectId, softwareAuthenticator(), true);

    expect(reported.outcome.kind).toBe('enrolled');
    expect(silent.outcome.kind).toBe('enrolled');
  });

  it('asks the client to report discoverability', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);

    const { offer } = await enrolPasskey(tenantId, subjectId, softwareAuthenticator(), true);

    expect(offer.options.extensions).toEqual({ credProps: true });
  });
});

async function passkeyRow(tenantId: string) {
  const rows = await withTenant(app.db, tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'authentication', limit: 50 }),
  );
  return rows.find((row) => row.action === 'login.passkey' && row.outcome === 'allowed');
}

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

  it('records that the person was not verified on the audit row, under the same action', async () => {
    const { tenantId, authenticator } = await seedWeakPasskey(false);

    await signInWithPasskey(tenantId, authenticator, 1, false);

    expect((await passkeyRow(tenantId))?.detail).toEqual({
      factor: 'passkey',
      user_verified: false,
    });
  });

  it('records that the person was verified when the assertion verified them', async () => {
    const { tenantId, authenticator } = await seedWeakPasskey(false);

    await signInWithPasskey(tenantId, authenticator, 1, true);

    expect((await passkeyRow(tenantId))?.detail).toEqual({
      factor: 'passkey',
      user_verified: true,
    });
  });
});
