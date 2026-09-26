import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
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
import { auditRepository, type AuditEventRecord } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareAuthenticator,
  startTestDatabase,
  type SoftwareAuthenticator,
  type TestDatabase,
} from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, initialChallenge, startAuthentication } from '#/usecase/executor';
import { beginPasskeyAuthentication } from '#/usecase/passkey-authentication';
import { completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

const SILENT_LOGGER = { error: (): void => undefined };

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

async function seedTenant(
  tx: TenantScopedDatabase,
  tenantId: string,
  otpRequired = false,
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

// A subject with a passkey on a software authenticator this suite keeps, so
// the assertions it signs later check against the public key this enrolment
// actually stored.
async function seedSubjectWithAPasskey(
  tenantId: string,
  options: { otpRequired?: boolean; signCount?: number } = {},
): Promise<{ subjectId: string; authenticator: SoftwareAuthenticator }> {
  const authenticator = softwareAuthenticator();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId, options.otpRequired ?? false);
    const subject = await seedUser(tx, tenantId, 'ada');
    await requiredActionRepository(tx).add(tenantId, subject, 'configure-passkey');
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    await authenticationSessionRepository(tx).bindSubject(authSessionId, subject);
    await authenticationSessionRepository(tx).setWebauthnChallenge(authSessionId, 'ZW5yb2wtbWU');
    const outcome = await completePasskeyEnrolment(tx, {
      tenantId,
      subjectId: subject,
      authSessionId,
      publicBaseUrl: PUBLIC_BASE_URL,
      response: authenticator.registration({
        challenge: 'ZW5yb2wtbWU',
        rpId: RP_ID,
        origin: PUBLIC_BASE_URL,
        signCount: options.signCount ?? 0,
      }),
    });
    expect(outcome.kind).toBe('enrolled');
    return subject;
  });
  return { subjectId, authenticator };
}

function start(tenantId: string): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    return authSessionId;
  });
}

// What the passkey button does: ask for options, which parks a fresh
// challenge on the attempt, then have the authenticator sign them.
async function assertWithPasskey(
  tenantId: string,
  authSessionId: string,
  authenticator: SoftwareAuthenticator,
  signCount: number,
): Promise<unknown> {
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginPasskeyAuthentication(tx, { publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
  );
  return authenticator.assertion({
    challenge: offer.challenge,
    rpId: RP_ID,
    origin: PUBLIC_BASE_URL,
    signCount,
  });
}

function submit(tenantId: string, authSessionId: string, assertion: unknown) {
  return withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { assertion }, undefined, {
      logger: SILENT_LOGGER,
      publicBaseUrl: PUBLIC_BASE_URL,
    }),
  );
}

function storedCounter(tenantId: string, subjectId: string): Promise<number | undefined> {
  return withTenant(app.db, tenantId, async (tx) => {
    const [credential] = await credentialRepository(tx).listFor(subjectId, 'webauthn');
    return credential?.secret.kind === 'webauthn' ? credential.secret.counter : undefined;
  });
}

describe('signing in with a passkey and no username', () => {
  it('offers a first step that asks for no assertion, so the page can offer both', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));

    const challenge = await withTenant(app.db, tenantId, (tx) => initialChallenge(tx, tenantId));

    // The passkey execution comes first in the flow, but a group offers one
    // form at a time: with nothing submitted it falls through to the
    // password, whose page carries the passkey button beside it.
    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });

  it('parks a fresh challenge on the attempt when options are asked for', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    const authSessionId = await start(tenantId);

    const offer = await withTenant(app.db, tenantId, (tx) =>
      beginPasskeyAuthentication(tx, { publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
    );

    expect(offer.options.allowCredentials).toBeUndefined();
    const record = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.webauthnChallenge).toBe(offer.challenge);
  });

  it('resolves the subject from the assertion alone and completes the login', async () => {
    const tenantId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 3 });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 4);

    const outcome = await submit(tenantId, authSessionId, assertion);

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
  });

  it('[WEBAUTHN2-7.2.21-01] advances the stored counter to what the authenticator reported', async () => {
    const tenantId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 3 });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 9);

    await submit(tenantId, authSessionId, assertion);

    expect(await storedCounter(tenantId, subjectId)).toBe(9);
  });

  it('does not ask for a code after a passkey, even where the tenant requires one', async () => {
    const tenantId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(tenantId, {
      otpRequired: true,
      signCount: 1,
    });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 2);

    const outcome = await submit(tenantId, authSessionId, assertion);

    // A passkey is two factors on its own, so the tenant's floor is already
    // met: no otp step, and no configure-totp owed for not having one.
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
    const owed = await withTenant(app.db, tenantId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(owed).not.toContain('configure-totp');
  });

  it('[WEBAUTHN2-7.2.21-02] refuses an assertion whose counter did not advance', async () => {
    const tenantId = newId();
    const { authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 6 });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 6);

    const outcome = await submit(tenantId, authSessionId, assertion);

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('refuses a replay of an assertion that already signed somebody in', async () => {
    const tenantId = newId();
    const { authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 1 });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 2);

    const first = await submit(tenantId, authSessionId, assertion);
    const second = await submit(tenantId, authSessionId, assertion);

    expect(first.kind).toBe('success');
    // The challenge was read and cleared in one statement by the first
    // attempt, so the second has nothing to verify against.
    expect(second).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('refuses an assertion for a credential enrolled in another tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const { authenticator } = await seedSubjectWithAPasskey(tenantA, { signCount: 1 });
    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));
    const authSessionId = await start(tenantB);
    const assertion = await assertWithPasskey(tenantB, authSessionId, authenticator, 2);

    const outcome = await submit(tenantB, authSessionId, assertion);

    // byLookupKey is tenant-scoped by RLS, so tenant A's credential resolves
    // to nothing here rather than to somebody else's subject.
    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  // The passkey step is the other one whose applicability a submission can
  // decide. Standing *up* on an input is safe where standing down is not:
  // the group is an ALTERNATIVE run, which isGroupSatisfied never satisfies
  // by inapplicability, and password is always applicable — so a junk
  // assertion takes the group's turn and is refused rather than skipping
  // anything.
  it('[WEBAUTHN2-7.2.22-01] refuses a junk assertion rather than letting the password beside it through', async () => {
    const tenantId = newId();
    await seedSubjectWithAPasskey(tenantId);
    const authSessionId = await start(tenantId);

    const outcome = await withTenant(app.db, tenantId, (tx) =>
      advance(
        tx,
        authSessionId,
        {
          username: 'ada',
          password: PASSWORD,
          assertion: { id: 'not-a-credential', rawId: 'x', type: 'public-key' },
        },
        undefined,
        { logger: SILENT_LOGGER },
      ),
    );

    expect(outcome.kind).toBe('failure');
  });

  it('leaves the password path alone: no assertion, no passkey step', async () => {
    const tenantId = newId();
    const { subjectId } = await seedSubjectWithAPasskey(tenantId);
    const authSessionId = await start(tenantId);

    const outcome = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, undefined, {
        logger: SILENT_LOGGER,
      }),
    );

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
  });
});

function loginRows(tenantId: string): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'authentication', limit: 50 }),
  );
}

describe('the row a passkey attempt writes', () => {
  it('records an accepted assertion as allowed, for the subject it named', async () => {
    const tenantId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 1 });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 2);

    await submit(tenantId, authSessionId, assertion);

    const rows = await loginRows(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'login.passkey',
      outcome: 'allowed',
      actorSubjectId: subjectId,
      actorClientId: null,
      resourceType: 'authentication_session',
      resourceId: authSessionId,
      detail: { factor: 'passkey' },
    });
  });

  it('records a counter that did not advance as a bad credential for that subject', async () => {
    const tenantId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 6 });
    const authSessionId = await start(tenantId);
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 6);

    await submit(tenantId, authSessionId, assertion);

    const rows = await loginRows(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'login.passkey',
      outcome: 'refused',
      actorSubjectId: subjectId,
      detail: { factor: 'passkey', reason: 'bad_credential' },
    });
  });

  it('records an assertion for somebody else as subject_mismatch, against the bound subject', async () => {
    const tenantId = newId();
    const { authenticator } = await seedSubjectWithAPasskey(tenantId, { signCount: 1 });
    const bound = await withTenant(app.db, tenantId, (tx) => seedUser(tx, tenantId, 'bob'));
    const authSessionId = await start(tenantId);
    await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).bindSubject(authSessionId, bound),
    );
    const assertion = await assertWithPasskey(tenantId, authSessionId, authenticator, 2);

    const outcome = await submit(tenantId, authSessionId, assertion);

    expect(outcome).toEqual({ kind: 'failure', reason: 'subject_mismatch' });
    const rows = await loginRows(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'login.passkey',
      outcome: 'refused',
      actorSubjectId: bound,
      detail: { factor: 'passkey', reason: 'subject_mismatch' },
    });
  });
});
