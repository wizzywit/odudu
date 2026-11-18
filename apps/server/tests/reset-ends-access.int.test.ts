import { enqueueActionsLink } from '@odudu/account';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
  tenants,
  withTenant,
} from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import {
  credentialRepository,
  userCredentials,
  userRepository,
  users,
} from '@odudu/domain-identity';
import { capturingSender, emailOutbox, sendPending, type EmailSender } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { clientOidcConfig, backchannelLogoutDeliveries } from '@odudu/protocol-oidc';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// Recovering an account ends whatever else is signed in to it: the sessions,
// and every grant, offline ones included. Whoever held the account before the
// reset (a person who registered an address that was not theirs, say) holds
// nothing after it, and somebody else's sign-in is left alone.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';
const PUBLIC_BASE_URL = 'https://idp.example.test';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a different passphrase, longer';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function buildTestApp(options: { publicBaseUrl?: string | undefined } = {}): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const publicBaseUrl = 'publicBaseUrl' in options ? options.publicBaseUrl : PUBLIC_BASE_URL;
  return buildApp({
    tls: false,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
  });
}

async function drain(into: EmailSender): Promise<void> {
  await sendPending(
    { database: appDb, ownerDatabase: owner, resolveSender: () => Promise.resolve(into) },
    new Date(),
    { batchSize: 50, maxAttempts: 3, retryBackoffSeconds: 60 },
  );
}

const authorizeQuery = (scope: string): string =>
  new URLSearchParams({
    response_type: 'code',
    client_id: 'reset-spa',
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  }).toString();

interface SignedIn {
  readonly refreshToken: string;
  readonly cookie: string;
}

async function signIn(
  app: FastifyInstance,
  tenant: string,
  username: string,
  scope = 'openid offline_access',
): Promise<SignedIn> {
  const page = await app.inject({
    url: `/tenants/${tenant}/protocol/openid-connect/auth?${authorizeQuery(scope)}`,
  });
  const session = /name="auth_session_id" value="([^"]*)"/u.exec(page.body)?.[1] ?? '';
  const login = await app.inject({
    method: 'POST',
    url: `/tenants/${tenant}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: session,
      username,
      password: PASSWORD,
    }).toString(),
    headers: FORM,
  });
  const code = /[?&]code=([^&]*)/u.exec(String(login.headers.location))?.[1];
  const cookie = /[a-z0-9-]+-session=[^;]+/u.exec(
    [login.headers['set-cookie']].flat().join('; '),
  )?.[0];
  if (code === undefined || cookie === undefined) throw new Error('sign-in did not complete');
  const token = await app.inject({
    method: 'POST',
    url: `/tenants/${tenant}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: 'reset-spa',
      code_verifier: VERIFIER,
    }).toString(),
    headers: FORM,
  });
  const refreshToken = token.json<{ refresh_token?: string }>().refresh_token ?? '';
  if (refreshToken === '' && scope.includes('offline_access')) {
    throw new Error('no refresh token issued');
  }
  return { refreshToken, cookie };
}

function refresh(app: FastifyInstance, tenant: string, refreshToken: string) {
  return app.inject({
    method: 'POST',
    url: `/tenants/${tenant}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'reset-spa',
    }).toString(),
    headers: FORM,
  });
}

describe('a password reset', () => {
  it('ends every session and grant of the account, and leaves another person signed in', async () => {
    const tenant = `reset-${newId()}`;
    const seeded = await seed({
      tenant,
      clientId: 'reset-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: 'ada@example.test',
    });
    await seed(['user', '--tenant', tenant, '--username', 'bob', '--password', PASSWORD]);
    await owner.db
      .update(tenants)
      .set({ resetPasswordAllowed: true })
      .where(eq(tenants.id, seeded.tenantId));
    await owner.db.delete(emailOutbox);
    const app = buildTestApp();
    await app.ready();

    try {
      const ada = await signIn(app, tenant, 'ada');
      const bob = await signIn(app, tenant, 'bob');
      const rotated = await refresh(app, tenant, ada.refreshToken);
      expect(rotated.statusCode).toBe(200);
      const adaLive = rotated.json<{ refresh_token: string }>().refresh_token;

      await app.inject({
        method: 'POST',
        url: `/tenants/${tenant}/login-actions/reset-password`,
        payload: new URLSearchParams({ email: 'ada@example.test' }).toString(),
        headers: FORM,
      });
      const sender = capturingSender();
      await drain(sender);
      const key = /[?&]key=([^&\s]+)/u.exec(sender.sent[0]?.text ?? '')?.[1] ?? '';
      const done = await app.inject({
        method: 'POST',
        url: `/tenants/${tenant}/login-actions/action-token`,
        payload: new URLSearchParams({ key, password: NEW_PASSWORD }).toString(),
        headers: FORM,
      });
      expect(done.statusCode).toBe(200);

      // The refresh token held before is dead, and the session cookie no longer
      // signs anybody in without the new password.
      const stale = await refresh(app, tenant, adaLive);
      expect(stale.statusCode).toBe(400);
      expect(stale.json<{ error: string }>().error).toBe('invalid_grant');
      const silent = await app.inject({
        url: `/tenants/${tenant}/protocol/openid-connect/auth?${authorizeQuery('openid offline_access')}`,
        headers: { cookie: ada.cookie },
      });
      expect(silent.statusCode).toBe(200);
      expect(silent.headers.location ?? '').not.toContain('code=');
      expect(silent.body).toContain('name="auth_session_id"');

      // Somebody else's sign-in is untouched.
      expect((await refresh(app, tenant, bob.refreshToken)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

interface Account {
  readonly email: string;
  readonly tenant: string;
  readonly tenantId: string;
  readonly subjectId: string;
}

async function account(emailVerified: boolean, selfRegistered = false): Promise<Account> {
  const tenant = `reset-${newId()}`;
  const seeded = await seed({
    tenant,
    clientId: 'reset-spa',
    redirectUris: [REDIRECT_URI],
    username: 'ada',
    password: PASSWORD,
    email: 'ada@example.test',
  });
  // verify_email off: a reset link reaches an unverified address only then.
  await owner.db
    .update(tenants)
    .set({ resetPasswordAllowed: true, verifyEmail: false })
    .where(eq(tenants.id, seeded.tenantId));
  const subjectId = await withTenant(appDb.db, seeded.tenantId, async (tx) => {
    const user = await userRepository(tx).byUsername('ada');
    if (user === null) throw new Error('no ada');
    if (emailVerified) await userRepository(tx).markEmailVerified(user.subject.id);
    return user.subject.id;
  });
  await owner.db.delete(emailOutbox);
  if (selfRegistered) {
    await owner.db.update(users).set({ selfRegistered }).where(eq(users.subjectId, subjectId));
  }
  return { tenant, tenantId: seeded.tenantId, subjectId, email: 'ada@example.test' };
}

async function mailedKey(who: Account, actions?: readonly string[]): Promise<string> {
  const sender = capturingSender();
  if (actions !== undefined) {
    await withTenant(appDb.db, who.tenantId, (tx) =>
      enqueueActionsLink(
        tx,
        {
          tenantId: who.tenantId,
          tenantName: who.tenant,
          tenantDisplayName: who.tenant,
          issuerBase: PUBLIC_BASE_URL,
          now: () => new Date(),
        },
        { subjectId: who.subjectId, email: who.email },
        { actions },
      ),
    );
  }
  await drain(sender);
  return /[?&]key=([^&\s]+)/u.exec(sender.sent[0]?.text ?? '')?.[1] ?? '';
}

function redeem(app: FastifyInstance, who: Account, key: string) {
  return app.inject({
    method: 'POST',
    url: `/tenants/${who.tenant}/login-actions/action-token`,
    payload: new URLSearchParams({ key, password: NEW_PASSWORD }).toString(),
    headers: FORM,
  });
}

describe('an actions link that sets a password', () => {
  it('ends every session and grant of the account, as the reset link does', async () => {
    const who = await account(true);
    const app = buildTestApp();
    await app.ready();
    try {
      const ada = await signIn(app, who.tenant, 'ada');
      const rotated = await refresh(app, who.tenant, ada.refreshToken);
      expect(rotated.statusCode).toBe(200);
      const live = rotated.json<{ refresh_token: string }>().refresh_token;

      const done = await redeem(app, who, await mailedKey(who, ['update-password']));
      expect(done.statusCode).toBe(200);

      const stale = await refresh(app, who.tenant, live);
      expect(stale.statusCode).toBe(400);
      expect(stale.json<{ error: string }>().error).toBe('invalid_grant');
    } finally {
      await app.close();
    }
  });

  it('signs the logout tokens it queues with the issuer the logout route uses', async () => {
    const who = await account(true);
    const app = buildTestApp({ publicBaseUrl: undefined });
    await app.ready();
    try {
      await signIn(app, who.tenant, 'ada', 'openid');
      await owner.db
        .update(clientOidcConfig)
        .set({ backchannelLogoutUri: 'https://rp.example/backchannel' })
        .where(eq(clientOidcConfig.tenantId, who.tenantId));

      expect((await redeem(app, who, await mailedKey(who, ['update-password']))).statusCode).toBe(
        200,
      );

      const rows = await owner.db
        .select({ token: backchannelLogoutDeliveries.logoutToken })
        .from(backchannelLogoutDeliveries)
        .where(eq(backchannelLogoutDeliveries.tenantId, who.tenantId));
      expect(rows).toHaveLength(1);
      const payload = JSON.parse(
        Buffer.from(rows[0]?.token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as { iss?: unknown };
      expect(payload.iss).toBe(`http://localhost/tenants/${who.tenant}`);
    } finally {
      await app.close();
    }
  });
});

async function enrolFactors(who: Account): Promise<void> {
  await withTenant(appDb.db, who.tenantId, async (tx) => {
    const credentials = credentialRepository(tx);
    const base = { tenantId: who.tenantId, subjectId: who.subjectId };
    await credentials.insert({
      ...base,
      type: 'totp',
      secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
    });
    await credentials.insert({
      ...base,
      type: 'webauthn',
      secret: { kind: 'webauthn', publicKey: 'cHVibGlj', counter: 0, transports: [] },
      lookupKey: `cred-${newId()}`,
    });
    await credentials.insert({
      ...base,
      type: 'recovery-code',
      secret: { kind: 'recovery-code', hash: 'hash-of-a-code' },
    });
  });
}

async function credentialTypes(who: Account): Promise<string[]> {
  const rows = await owner.db
    .select({ type: userCredentials.type })
    .from(userCredentials)
    .where(eq(userCredentials.subjectId, who.subjectId));
  return rows.map((row) => row.type).sort();
}

async function addressVerified(who: Account): Promise<boolean | undefined> {
  const rows = await owner.db
    .select({ verified: users.emailVerified })
    .from(users)
    .where(eq(users.subjectId, who.subjectId));
  return rows[0]?.verified;
}

describe('a reset', () => {
  const linkKinds = [
    ['reset link', undefined],
    ['actions link', ['update-password']],
  ] as const;

  async function redeemFor(who: Account, actions: readonly string[] | undefined) {
    const app = buildTestApp();
    await app.ready();
    try {
      if (actions === undefined) {
        await app.inject({
          method: 'POST',
          url: `/tenants/${who.tenant}/login-actions/reset-password`,
          payload: new URLSearchParams({ email: who.email }).toString(),
          headers: FORM,
        });
      }
      return await redeem(app, who, await mailedKey(who, actions));
    } finally {
      await app.close();
    }
  }

  const ALL = ['password', 'recovery-code', 'totp', 'webauthn'];

  it.each(linkKinds)(
    'removes the factors of a self-registered account nobody verified, and says so: %s',
    async (_kind, actions) => {
      const who = await account(false, true);
      await enrolFactors(who);
      expect(await credentialTypes(who)).toEqual(ALL);

      const done = await redeemFor(who, actions);
      expect(done.statusCode).toBe(200);
      expect(done.body).toContain('We removed the authenticator app, passkeys and recovery codes');

      expect(await credentialTypes(who)).toEqual(['password']);
      expect(await addressVerified(who)).toBe(true);
      const rows = await owner.db
        .select({ resourceId: auditEvents.resourceId })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenantId, who.tenantId),
            eq(auditEvents.action, 'account.address_proved'),
          ),
        );
      expect(rows).toEqual([{ resourceId: who.subjectId }]);
    },
  );

  it.each(linkKinds)(
    'leaves the factors of an account an administrator or the seed made: %s',
    async (_kind, actions) => {
      const who = await account(false, false);
      await enrolFactors(who);
      const done = await redeemFor(who, actions);
      expect(done.statusCode).toBe(200);
      expect(done.body).not.toContain('We removed');
      expect(await credentialTypes(who)).toEqual(ALL);
      expect(await addressVerified(who)).toBe(false);
    },
  );

  it('leaves the factors when an administrator changes the address of a verified account', async () => {
    const original = await account(true, true);
    await enrolFactors(original);
    const who = { ...original, email: 'ada.new@example.test' };
    await withTenant(appDb.db, who.tenantId, (tx) =>
      userRepository(tx).updateEmail(who.subjectId, who.email),
    );
    expect(await addressVerified(who)).toBe(false);

    expect((await redeemFor(who, undefined)).statusCode).toBe(200);
    expect(await credentialTypes(who)).toEqual(ALL);
  });

  it('leaves the factors once the address has been verified, even if it is later unverified', async () => {
    const who = await account(false, true);
    await enrolFactors(who);
    await withTenant(appDb.db, who.tenantId, async (tx) => {
      await userRepository(tx).setVerification(who.subjectId, { emailVerified: true });
      await userRepository(tx).setVerification(who.subjectId, { emailVerified: false });
    });

    expect((await redeemFor(who, undefined)).statusCode).toBe(200);
    expect(await credentialTypes(who)).toEqual(ALL);
  });

  it('leaves the factors of a self-registered account whose address was verified', async () => {
    const who = await account(true, true);
    await enrolFactors(who);
    expect((await redeemFor(who, undefined)).statusCode).toBe(200);
    expect(await credentialTypes(who)).toEqual(ALL);
  });
});
