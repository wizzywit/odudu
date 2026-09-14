import {
  realms,
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { effectiveRoles, roleRepository } from '@odudu/domain-authz';
import { userRepository } from '@odudu/domain-identity';
import { capturingSender, type EmailMessage } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

const PUBLIC_BASE_URL = 'https://idp.example.test';

// packages/account/tests/register.int.test.ts covers registration itself
// against a fake createAccount. The property that a self-registered but
// unverified address must not let a login through to a code needs the real
// composition root instead — apps/server/src/app.ts, @odudu/protocol-oidc's
// login flow and domain-identity's email_verified column, wired together
// the way they are in production. This file is that.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';
// RFC 7636 Appendix B's worked example; the verifier is never needed here
// since these tests stop at the login redirect and never reach /token.
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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

function buildTestApp(sender: ReturnType<typeof capturingSender>): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    sender,
    ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
      : {}),
  });
}

async function setRealmSettings(
  realmId: string,
  settings: { registrationAllowed?: boolean; verifyEmail?: boolean },
): Promise<void> {
  await owner.db.update(realms).set(settings).where(eq(realms.id, realmId));
}

async function extractAuthSessionId(instance: FastifyInstance, realmName: string): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'register-spa',
    redirect_uri: REDIRECT_URI,
    scope: 'openid email',
    state: 'xyz-123',
    nonce: 'n-0S6_WzA2Mj',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const res = await instance.inject({
    url: `/realms/${realmName}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

async function attemptLogin(
  instance: FastifyInstance,
  realmName: string,
  username: string,
  password: string,
) {
  const authSessionId = await extractAuthSessionId(instance, realmName);
  const loginForm = new URLSearchParams({ auth_session_id: authSessionId, username, password });
  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: loginForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function registerAccount(
  instance: FastifyInstance,
  realmName: string,
  input: { username: string; email: string; password: string },
  extraHeaders: Record<string, string> = {},
): Promise<number> {
  const form = new URLSearchParams(input);
  const res = await instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/registration`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
  });
  return res.statusCode;
}

function extractVerificationKey(message: EmailMessage): string {
  const match = /[?&]key=([^&\s]+)/.exec(message.text);
  const key = match?.[1];
  if (key === undefined) throw new Error(`no key found in ${message.text}`);
  return key;
}

describe('self-registration, through the real composition root', () => {
  it('refuses to complete a login until the address is verified, and lets it through once it is', async () => {
    const realmName = `register-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'register-spa',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true, verifyEmail: true });
    await withRealm(appDb.db, seeded.realmId, (tx) =>
      roleRepository(tx).create({
        realmId: seeded.realmId,
        name: 'offline_access',
        defaultForNewSubjects: true,
      }),
    );

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      const registered = await registerAccount(app, realmName, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery staple',
      });
      expect(registered).toBe(201);
      expect(sender.sent).toHaveLength(1);

      // The only assertion that would fail if apps/server/src/app.ts's own
      // default-role-assignment loop were deleted: packages/account's tests
      // exercise a copy of that loop against a fake createAccount, not the
      // real composition root this file builds.
      const registeredSubject = await withRealm(appDb.db, seeded.realmId, (tx) =>
        userRepository(tx).byUsername('ada'),
      );
      if (registeredSubject === null) throw new Error('registered user not found');
      const roles = await withRealm(appDb.db, seeded.realmId, (tx) =>
        effectiveRoles(tx, registeredSubject.subject.id),
      );
      expect(roles.map((role) => role.name)).toEqual(['offline_access']);

      const beforeVerification = await attemptLogin(
        app,
        realmName,
        'ada',
        'correct horse battery staple',
      );
      expect(beforeVerification.statusCode).toBe(200);
      expect(beforeVerification.body).toContain('verify');
      expect(beforeVerification.headers.location).toBeUndefined();
      expect(beforeVerification.headers['set-cookie']).toBeUndefined();

      const message = sender.sent[0];
      if (message === undefined) throw new Error('no verification mail sent');
      const key = extractVerificationKey(message);
      const redeemRes = await app.inject({
        method: 'GET',
        url: `/realms/${realmName}/login-actions/action-token?key=${key}`,
      });
      expect(redeemRes.statusCode).toBe(200);

      const afterVerification = await attemptLogin(
        app,
        realmName,
        'ada',
        'correct horse battery staple',
      );
      expect(afterVerification.headers.location).toContain('code=');
    } finally {
      await app.close();
    }
  });

  it('completes a login immediately when the realm does not require verification', async () => {
    const realmName = `register-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'register-spa',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true, verifyEmail: false });

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      const registered = await registerAccount(app, realmName, {
        username: 'grace',
        email: 'grace@example.test',
        password: 'correct horse battery staple',
      });
      expect(registered).toBe(201);
      expect(sender.sent).toHaveLength(0);

      const login = await attemptLogin(app, realmName, 'grace', 'correct horse battery staple');
      expect(login.headers.location).toContain('code=');
    } finally {
      await app.close();
    }
  });

  // The Host header is client-controlled — Fastify reads it verbatim, and
  // trustProxy does not change that — so a mailed verification link must
  // never be built from it. An attacker registering the victim's address
  // with a forged Host would otherwise receive, in the victim's inbox, a
  // link to a host of the attacker's choosing, capture the key, and verify
  // an address they do not control against an account they hold the
  // password to.
  it('ignores a forged Host header and mails a link at the configured public base url', async () => {
    const realmName = `register-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'register-spa',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true, verifyEmail: true });

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      const registered = await registerAccount(
        app,
        realmName,
        { username: 'ada', email: 'ada@example.test', password: 'correct horse battery staple' },
        { host: 'evil.example' },
      );
      expect(registered).toBe(201);

      const message = sender.sent[0];
      if (message === undefined) throw new Error('no verification mail sent');
      expect(message.text).toContain(`${PUBLIC_BASE_URL}/realms/${realmName}/`);
      expect(message.text).not.toContain('evil.example');
    } finally {
      await app.close();
    }
  });
});
