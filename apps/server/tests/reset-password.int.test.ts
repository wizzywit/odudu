import {
  realms,
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
} from '@odudu/db';
import { userCredentials } from '@odudu/domain-identity';
import { capturingSender, type EmailMessage } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq, sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

const PUBLIC_BASE_URL = 'https://idp.example.test';

// packages/account/tests/reset-password.int.test.ts covers the flow itself
// against fakes for findByEmail/setPassword. Two properties need the real
// composition root instead: that the old password genuinely stops getting
// an authorization code and the new one genuinely gets one (protocol-oidc's
// login route, which @odudu/account cannot import — see CLAUDE.md's
// layering table), and that the mailed link's base survives a forged Host
// the same way registration's does. This file is that, mirroring
// register.int.test.ts and verify-email.int.test.ts.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'ada@example.test';
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

async function setResetPasswordAllowed(realmId: string, allowed: boolean): Promise<void> {
  await owner.db
    .update(realms)
    .set({ resetPasswordAllowed: allowed })
    .where(eq(realms.id, realmId));
}

async function setPasswordMaxAgeDays(realmId: string, days: number): Promise<void> {
  await owner.db.update(realms).set({ passwordMaxAgeDays: days }).where(eq(realms.id, realmId));
}

// created_at is written by the database's own now(), so standing a password
// in the past is the only way to make the realm's maximum age bite.
async function agePassword(realmId: string, days: number): Promise<void> {
  await owner.db
    .update(userCredentials)
    .set({ createdAt: sql`now() - ${`${String(days)} days`}::interval` })
    .where(and(eq(userCredentials.realmId, realmId), eq(userCredentials.type, 'password')));
}

async function extractAuthSessionId(instance: FastifyInstance, realmName: string): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'reset-spa',
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

async function attemptLogin(instance: FastifyInstance, realmName: string, password: string) {
  const authSessionId = await extractAuthSessionId(instance, realmName);
  const loginForm = new URLSearchParams({
    auth_session_id: authSessionId,
    username: 'ada',
    password,
  });
  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: loginForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function requestReset(
  instance: FastifyInstance,
  realmName: string,
  email: string,
  extraHeaders: Record<string, string> = {},
) {
  const form = new URLSearchParams({ email });
  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/reset-password`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
  });
}

function extractLink(message: EmailMessage): string {
  const match = /visiting this link:\n\n(\S+)/.exec(message.text);
  const link = match?.[1];
  if (link === undefined) throw new Error(`no link found in ${message.text}`);
  return link;
}

async function submitNewPassword(instance: FastifyInstance, link: string, password: string) {
  const key = new URL(link).searchParams.get('key');
  if (key === null) throw new Error(`no key in ${link}`);
  const form = new URLSearchParams({ key, password });
  return instance.inject({
    method: 'POST',
    url: new URL(link).pathname,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('password reset, through the real composition root', () => {
  it('lets the new password sign in and refuses the old one, all the way to an authorization code', async () => {
    const realmName = `reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'reset-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setResetPasswordAllowed(seeded.realmId, true);

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      const requested = await requestReset(app, realmName, EMAIL);
      expect(requested.statusCode).toBe(200);
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no reset mail sent');
      const link = extractLink(message);

      const submitted = await submitNewPassword(app, link, 'a brand new password');
      expect(submitted.statusCode).toBe(200);

      const withOldPassword = await attemptLogin(app, realmName, PASSWORD);
      expect(withOldPassword.statusCode).toBe(200);
      expect(withOldPassword.headers.location).toBeUndefined();

      const withNewPassword = await attemptLogin(app, realmName, 'a brand new password');
      expect(withNewPassword.headers.location).toContain('code=');
    } finally {
      await app.close();
    }
  });

  // The Host header is client-controlled — Fastify reads it verbatim, and
  // trustProxy does not change that — so a mailed reset link must never be
  // built from it. A reset link is strictly more dangerous than a
  // verification link to get this wrong on: it is a full account-takeover
  // primitive by itself, not merely proof of an address. Mirrors
  // register.int.test.ts's equivalent test for the verify_email link.
  it('ignores a forged Host header and mails the reset link at the configured public base url', async () => {
    const realmName = `reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'reset-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setResetPasswordAllowed(seeded.realmId, true);

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      const requested = await requestReset(app, realmName, EMAIL, { host: 'evil.example' });
      expect(requested.statusCode).toBe(200);

      const message = sender.sent[0];
      if (message === undefined) throw new Error('no reset mail sent');
      expect(message.text).toContain(`${PUBLIC_BASE_URL}/realms/${realmName}/`);
      expect(message.text).not.toContain('evil.example');
    } finally {
      await app.close();
    }
  });

  // Completing one reset must retire every other outstanding reset link for
  // the same subject — a prior request the user forgot about, or one an
  // attacker triggered — not just the one just spent. Two requests, two
  // mails, one completed: the second must already be dead, not merely
  // eligible to become dead the next time someone tries a stale link.
  it('kills a sibling reset link once one of them is completed', async () => {
    const realmName = `reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'reset-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setResetPasswordAllowed(seeded.realmId, true);

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      await requestReset(app, realmName, EMAIL);
      await requestReset(app, realmName, EMAIL);
      expect(sender.sent).toHaveLength(2);

      const [firstMessage, secondMessage] = sender.sent;
      if (firstMessage === undefined || secondMessage === undefined) {
        throw new Error('expected two reset mails');
      }
      const firstLink = extractLink(firstMessage);
      const secondLink = extractLink(secondMessage);

      const completedFirst = await submitNewPassword(app, firstLink, 'first new password');
      expect(completedFirst.statusCode).toBe(200);

      // The second link was never itself submitted, and its own five
      // minutes have not elapsed — the only thing that could have killed
      // it is completing the first.
      const attemptSecond = await submitNewPassword(app, secondLink, 'second new password');
      expect(attemptSecond.statusCode).toBe(400);

      const withFirstPassword = await attemptLogin(app, realmName, 'first new password');
      expect(withFirstPassword.headers.location).toContain('code=');
      const withSecondPassword = await attemptLogin(app, realmName, 'second new password');
      expect(withSecondPassword.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('refuses to redeem an outstanding link once reset_password_allowed is turned off', async () => {
    const realmName = `reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'reset-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setResetPasswordAllowed(seeded.realmId, true);

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      await requestReset(app, realmName, EMAIL);
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no reset mail sent');
      const link = extractLink(message);

      await setResetPasswordAllowed(seeded.realmId, false);

      const getForm = await app.inject({ url: new URL(link).pathname + new URL(link).search });
      expect(getForm.statusCode).toBe(400);

      const submitted = await submitNewPassword(app, link, 'a brand new password');
      expect(submitted.statusCode).toBe(400);

      // The redemption was refused, not merely delayed: the password the
      // link would have set never takes effect, and the original one still
      // signs in.
      const withOldPassword = await attemptLogin(app, realmName, PASSWORD);
      expect(withOldPassword.headers.location).toContain('code=');
      const withAttemptedNewPassword = await attemptLogin(app, realmName, 'a brand new password');
      expect(withAttemptedNewPassword.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  // Moving created_at on every password write is what stops an expired
  // password being owed forever — and it is also what would let expiry be
  // evaded, if a reset could set the password already in force straight
  // back. Anybody who can read the account's mail would otherwise clear a
  // realm's password_max_age_days without ever changing a password.
  it('refuses a reset to the password already in force, and does not burn the link doing it', async () => {
    const realmName = `reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'reset-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    await setResetPasswordAllowed(seeded.realmId, true);
    await setPasswordMaxAgeDays(seeded.realmId, 1);
    await agePassword(seeded.realmId, 7);

    const sender = capturingSender();
    const app = buildTestApp(sender);
    await app.ready();

    try {
      // The login authenticates and stops short of a code: update-password
      // is owed, which is the state the evasion below would clear.
      const expired = await attemptLogin(app, realmName, PASSWORD);
      expect(expired.statusCode).toBe(200);
      expect(expired.body).toContain('Change your password');
      expect(expired.headers.location).toBeUndefined();

      await requestReset(app, realmName, EMAIL);
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no reset mail sent');
      const link = extractLink(message);

      const unchanged = await submitNewPassword(app, link, PASSWORD);
      expect(unchanged.statusCode).toBe(400);
      expect(unchanged.body).toContain('one you have used before');

      // Still expired, so still owed: nothing about the refused redemption
      // moved the clock.
      const stillExpired = await attemptLogin(app, realmName, PASSWORD);
      expect(stillExpired.body).toContain('Change your password');
      expect(stillExpired.headers.location).toBeUndefined();

      // And the link survived the refusal, the same way a weak password
      // does not burn it: a real change still redeems it.
      const changed = await submitNewPassword(app, link, 'a brand new password');
      expect(changed.statusCode).toBe(200);

      // The action the expired password owed is gone, so the new password
      // reaches a code rather than being asked for a third one.
      const withNewPassword = await attemptLogin(app, realmName, 'a brand new password');
      expect(withNewPassword.body).not.toContain('Change your password');
      expect(withNewPassword.headers.location).toContain('code=');
    } finally {
      await app.close();
    }
  });
});
