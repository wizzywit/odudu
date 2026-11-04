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
import { advance, startAuthentication } from '#/usecase/executor';
import { beginPasskeyAuthentication } from '#/usecase/passkey-authentication';
import { beginPasskeyEnrolment, completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
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
const PATH_RP = { id: 'localhost', origin: 'http://localhost:3000' };
// A verified host belongs to one tenant, so each test names its own.
const domainOf = (tenantId: string): string => `d${tenantId.slice(-12)}.acme.test`;
const domainRp = (tenantId: string) => ({
  id: domainOf(tenantId),
  origin: `http://${domainOf(tenantId)}`,
});
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

async function seedTenant(tenantId: string): Promise<string> {
  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
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
    return subject.id;
  });
  return subjectId;
}

async function setCanonical(tenantId: string, host: string | null): Promise<void> {
  await owner.sql`delete from tenant_domains where tenant_id = ${tenantId}`;
  if (host === null) return;
  await owner.sql`
    insert into tenant_domains (id, tenant_id, host, state, challenge, verified_at, canonical)
    values (gen_random_uuid(), ${tenantId}, ${host}, 'verified', 'c', now(), true)`;
}

function startSession(tenantId: string, subjectId: string | null): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    if (subjectId !== null) {
      await authenticationSessionRepository(tx).bindSubject(authSessionId, subjectId);
    }
    return authSessionId;
  });
}

// What the browser does at the address it is on: ask for creation options,
// have the authenticator sign them for that address, post the result back.
async function enrolAt(
  tenantId: string,
  subjectId: string,
  authenticator: SoftwareAuthenticator,
  at: { id: string; origin: string },
  signCount = 0,
): Promise<string> {
  await withTenant(app.db, tenantId, (tx) =>
    requiredActionRepository(tx).add(tenantId, subjectId, 'configure-passkey'),
  );
  const authSessionId = await startSession(tenantId, subjectId);
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginPasskeyEnrolment(tx, {
      tenantId,
      tenantName: `tenant-${tenantId}`,
      publicBaseUrl: PUBLIC_BASE_URL,
      authSessionId,
      subjectId,
    }),
  );
  expect(offer.options.rp.id).toBe(at.id);
  const outcome = await withTenant(app.db, tenantId, (tx) =>
    completePasskeyEnrolment(tx, {
      tenantId,
      subjectId,
      authSessionId,
      publicBaseUrl: PUBLIC_BASE_URL,
      response: authenticator.registration({
        challenge: offer.options.challenge,
        rpId: at.id,
        origin: at.origin,
        signCount,
      }),
    }),
  );
  if (outcome.kind !== 'enrolled') throw new Error(`expected an enrolment, got ${outcome.kind}`);
  return outcome.credentialId;
}

async function storedRpId(tenantId: string, lookupKey: string): Promise<string | null> {
  const rows = await owner.sql<{ rp_id: string | null }[]>`
    select rp_id from user_credentials
     where tenant_id = ${tenantId} and lookup_key = ${lookupKey}`;
  return rows[0]?.rp_id ?? null;
}

// Sign in with a passkey at the address the browser is on, which is the
// address the authenticator signs for; the server decides which one that is.
async function signInAt(
  tenantId: string,
  authenticator: SoftwareAuthenticator,
  at: { id: string; origin: string },
  signCount: number,
) {
  const authSessionId = await startSession(tenantId, null);
  const offer = await withTenant(app.db, tenantId, (tx) =>
    beginPasskeyAuthentication(tx, { tenantId, publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
  );
  const assertion = authenticator.assertion({
    challenge: offer.challenge,
    rpId: at.id,
    origin: at.origin,
    signCount,
  });
  const outcome = await withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { assertion }, undefined, {
      logger: SILENT_LOGGER,
      publicBaseUrl: PUBLIC_BASE_URL,
    }),
  );
  return { rpId: offer.options.rpId, outcome };
}

describe('a passkey and the canonical address', () => {
  it('records the base host for a tenant on the path address', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);

    const credentialId = await enrolAt(tenantId, subjectId, softwareAuthenticator(), PATH_RP);

    expect(await storedRpId(tenantId, credentialId)).toBe('localhost');
  });

  it('records the canonical domain for a tenant that has one', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    await setCanonical(tenantId, domainOf(tenantId));

    const credentialId = await enrolAt(
      tenantId,
      subjectId,
      softwareAuthenticator(),
      domainRp(tenantId),
    );

    expect(await storedRpId(tenantId, credentialId)).toBe(domainOf(tenantId));
  });

  it('refuses an enrolment signed for the address the tenant left', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    await setCanonical(tenantId, domainOf(tenantId));
    const authSessionId = await startSession(tenantId, subjectId);
    const offer = await withTenant(app.db, tenantId, (tx) =>
      beginPasskeyEnrolment(tx, {
        tenantId,
        tenantName: 'acme',
        publicBaseUrl: PUBLIC_BASE_URL,
        authSessionId,
        subjectId,
      }),
    );

    const outcome = await withTenant(app.db, tenantId, (tx) =>
      completePasskeyEnrolment(tx, {
        tenantId,
        subjectId,
        authSessionId,
        publicBaseUrl: PUBLIC_BASE_URL,
        response: softwareAuthenticator().registration({
          challenge: offer.options.challenge,
          rpId: PATH_RP.id,
          origin: PATH_RP.origin,
        }),
      }),
    );

    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_response' });
  });

  it('offers the canonical relying party id when asked for sign-in options', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    const authSessionId = await startSession(tenantId, null);
    const options = () =>
      withTenant(app.db, tenantId, (tx) =>
        beginPasskeyAuthentication(tx, { tenantId, publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
      );

    expect((await options()).options.rpId).toBe('localhost');
    await setCanonical(tenantId, domainOf(tenantId));
    expect((await options()).options.rpId).toBe(domainOf(tenantId));
  });

  it('does not sign in at the domain a passkey registered at the path address, and does again after switching back', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const authenticator = softwareAuthenticator();
    await enrolAt(tenantId, subjectId, authenticator, PATH_RP);

    await setCanonical(tenantId, domainOf(tenantId));
    const atDomain = await signInAt(tenantId, authenticator, domainRp(tenantId), 1);
    expect(atDomain.rpId).toBe(domainOf(tenantId));
    expect(atDomain.outcome.kind).toBe('failure');

    await setCanonical(tenantId, null);
    const back = await signInAt(tenantId, authenticator, PATH_RP, 2);
    expect(back.outcome.kind).toBe('success');
  });

  it('signs in at the domain with a passkey registered there, and not at the path address', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    await setCanonical(tenantId, domainOf(tenantId));
    const authenticator = softwareAuthenticator();
    await enrolAt(tenantId, subjectId, authenticator, domainRp(tenantId));

    const atDomain = await signInAt(tenantId, authenticator, domainRp(tenantId), 1);
    expect(atDomain.outcome.kind).toBe('success');

    await setCanonical(tenantId, null);
    const atPath = await signInAt(tenantId, authenticator, PATH_RP, 2);
    expect(atPath.outcome.kind).toBe('failure');
  });

  it('refuses a passkey whose recorded id is another address even when the assertion is signed for this one', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const authenticator = softwareAuthenticator();
    const credentialId = await enrolAt(tenantId, subjectId, authenticator, PATH_RP);
    await owner.sql`
      update user_credentials set rp_id = 'elsewhere.example'
       where tenant_id = ${tenantId} and lookup_key = ${credentialId}`;

    const refused = await signInAt(tenantId, authenticator, PATH_RP, 1);

    expect(refused.outcome.kind).toBe('failure');
  });

  it('reads a passkey with no recorded id as belonging to the base host', async () => {
    const tenantId = newId();
    const subjectId = await seedTenant(tenantId);
    const authenticator = softwareAuthenticator();
    const credentialId = await enrolAt(tenantId, subjectId, authenticator, PATH_RP);
    await owner.sql`
      update user_credentials set rp_id = null
       where tenant_id = ${tenantId} and lookup_key = ${credentialId}`;

    const atPath = await signInAt(tenantId, authenticator, PATH_RP, 1);
    expect(atPath.outcome.kind).toBe('success');

    await setCanonical(tenantId, domainOf(tenantId));
    const atDomain = await signInAt(tenantId, authenticator, domainRp(tenantId), 2);
    expect(atDomain.outcome.kind).toBe('failure');
  });

  it('agrees with the count a switch is warned with: a hidden subject cannot sign in, a visible one can', async () => {
    const tenantId = newId();
    const pathSubject = await seedTenant(tenantId);
    const pathPasskey = softwareAuthenticator();
    await enrolAt(tenantId, pathSubject, pathPasskey, PATH_RP);

    await setCanonical(tenantId, domainOf(tenantId));
    const hiddenBySwitch = (rpId: string) =>
      withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).subjectsWithPasskeyOutside(rpId, 10),
      );

    expect(await hiddenBySwitch(domainOf(tenantId))).toEqual({ subjects: 1, capped: false });
    expect((await signInAt(tenantId, pathPasskey, domainRp(tenantId), 1)).outcome.kind).toBe(
      'failure',
    );

    expect(await hiddenBySwitch('localhost')).toEqual({ subjects: 0, capped: false });
    await setCanonical(tenantId, null);
    expect((await signInAt(tenantId, pathPasskey, PATH_RP, 2)).outcome.kind).toBe('success');
  });
});
