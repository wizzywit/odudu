import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, initialChallenge, startAuthentication } from '#/usecase/executor';
import { beginPasskeyAuthentication } from '#/usecase/passkey-authentication';
import { completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

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

async function seedRealm(
  tx: RealmScopedDatabase,
  realmId: string,
  otpRequired = false,
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

// A subject with a passkey on a software authenticator this suite keeps, so
// the assertions it signs later check against the public key this enrolment
// actually stored.
async function seedSubjectWithAPasskey(
  realmId: string,
  options: { otpRequired?: boolean; signCount?: number } = {},
): Promise<{ subjectId: string; authenticator: SoftwareAuthenticator }> {
  const authenticator = softwareAuthenticator();
  const subjectId = await withRealm(app.db, realmId, async (tx) => {
    await seedRealm(tx, realmId, options.otpRequired ?? false);
    const subject = await seedUser(tx, realmId, 'ada');
    await requiredActionRepository(tx).add(realmId, subject, 'configure-passkey');
    const { authSessionId } = await startAuthentication(tx, realmId, request);
    await authenticationSessionRepository(tx).bindSubject(authSessionId, subject);
    await authenticationSessionRepository(tx).setWebauthnChallenge(authSessionId, 'ZW5yb2wtbWU');
    const outcome = await completePasskeyEnrolment(tx, {
      realmId,
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

function start(realmId: string): Promise<string> {
  return withRealm(app.db, realmId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, realmId, request);
    return authSessionId;
  });
}

// What the passkey button does: ask for options, which parks a fresh
// challenge on the attempt, then have the authenticator sign them.
async function assertWithPasskey(
  realmId: string,
  authSessionId: string,
  authenticator: SoftwareAuthenticator,
  signCount: number,
): Promise<unknown> {
  const offer = await withRealm(app.db, realmId, (tx) =>
    beginPasskeyAuthentication(tx, { publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
  );
  return authenticator.assertion({
    challenge: offer.challenge,
    rpId: RP_ID,
    origin: PUBLIC_BASE_URL,
    signCount,
  });
}

function submit(realmId: string, authSessionId: string, assertion: unknown) {
  return withRealm(app.db, realmId, (tx) =>
    advance(tx, authSessionId, { assertion }, undefined, { publicBaseUrl: PUBLIC_BASE_URL }),
  );
}

function storedCounter(realmId: string, subjectId: string): Promise<number | undefined> {
  return withRealm(app.db, realmId, async (tx) => {
    const [credential] = await credentialRepository(tx).listFor(subjectId, 'webauthn');
    return credential?.secret.kind === 'webauthn' ? credential.secret.counter : undefined;
  });
}

describe('signing in with a passkey and no username', () => {
  it('offers a first step that asks for no assertion, so the page can offer both', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));

    const challenge = await withRealm(app.db, realmId, (tx) => initialChallenge(tx, realmId));

    // The passkey execution comes first in the flow, but a group offers one
    // form at a time: with nothing submitted it falls through to the
    // password, whose page carries the passkey button beside it.
    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });

  it('parks a fresh challenge on the attempt when options are asked for', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, (tx) => seedRealm(tx, realmId));
    const authSessionId = await start(realmId);

    const offer = await withRealm(app.db, realmId, (tx) =>
      beginPasskeyAuthentication(tx, { publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
    );

    expect(offer.options.allowCredentials).toBeUndefined();
    const record = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.webauthnChallenge).toBe(offer.challenge);
  });

  it('resolves the subject from the assertion alone and completes the login', async () => {
    const realmId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(realmId, { signCount: 3 });
    const authSessionId = await start(realmId);
    const assertion = await assertWithPasskey(realmId, authSessionId, authenticator, 4);

    const outcome = await submit(realmId, authSessionId, assertion);

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
  });

  it('advances the stored counter to what the authenticator reported', async () => {
    const realmId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(realmId, { signCount: 3 });
    const authSessionId = await start(realmId);
    const assertion = await assertWithPasskey(realmId, authSessionId, authenticator, 9);

    await submit(realmId, authSessionId, assertion);

    expect(await storedCounter(realmId, subjectId)).toBe(9);
  });

  it('does not ask for a code after a passkey, even where the realm requires one', async () => {
    const realmId = newId();
    const { subjectId, authenticator } = await seedSubjectWithAPasskey(realmId, {
      otpRequired: true,
      signCount: 1,
    });
    const authSessionId = await start(realmId);
    const assertion = await assertWithPasskey(realmId, authSessionId, authenticator, 2);

    const outcome = await submit(realmId, authSessionId, assertion);

    // A passkey is two factors on its own, so the realm's floor is already
    // met: no otp step, and no configure-totp owed for not having one.
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
    const owed = await withRealm(app.db, realmId, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(owed).not.toContain('configure-totp');
  });

  it('refuses an assertion whose counter did not advance', async () => {
    const realmId = newId();
    const { authenticator } = await seedSubjectWithAPasskey(realmId, { signCount: 6 });
    const authSessionId = await start(realmId);
    const assertion = await assertWithPasskey(realmId, authSessionId, authenticator, 6);

    const outcome = await submit(realmId, authSessionId, assertion);

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('refuses a replay of an assertion that already signed somebody in', async () => {
    const realmId = newId();
    const { authenticator } = await seedSubjectWithAPasskey(realmId, { signCount: 1 });
    const authSessionId = await start(realmId);
    const assertion = await assertWithPasskey(realmId, authSessionId, authenticator, 2);

    const first = await submit(realmId, authSessionId, assertion);
    const second = await submit(realmId, authSessionId, assertion);

    expect(first.kind).toBe('success');
    // The challenge was read and cleared in one statement by the first
    // attempt, so the second has nothing to verify against.
    expect(second).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('refuses an assertion for a credential enrolled in another realm', async () => {
    const realmA = newId();
    const realmB = newId();
    const { authenticator } = await seedSubjectWithAPasskey(realmA, { signCount: 1 });
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));
    const authSessionId = await start(realmB);
    const assertion = await assertWithPasskey(realmB, authSessionId, authenticator, 2);

    const outcome = await submit(realmB, authSessionId, assertion);

    // byLookupKey is realm-scoped by RLS, so realm A's credential resolves
    // to nothing here rather than to somebody else's subject.
    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('leaves the password path alone: no assertion, no passkey step', async () => {
    const realmId = newId();
    const { subjectId } = await seedSubjectWithAPasskey(realmId);
    const authSessionId = await start(realmId);

    const outcome = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: PASSWORD }),
    );

    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
  });
});
