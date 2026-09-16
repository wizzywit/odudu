import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  type DatabaseHandle,
} from '@odudu/db';
import {
  capturingSender,
  emailOutbox,
  sendPending,
  type EmailMessage,
  type EmailSender,
  type SendPendingOptions,
} from '@odudu/email';
import { loadConfig, MAX_PASSWORD_LENGTH, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { userCredentials } from '@odudu/domain-identity';
import { and, eq, sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// register.int.test.ts and reset-password.int.test.ts (packages/account)
// each carry their own weak-password case against a fake
// createAccount/setPassword. Neither can prove the *same* realm policy
// binds every writer: the seed CLI and the change-password required
// action are not @odudu/account's to reach — it depends on neither
// @odudu/authn-flows nor apps/server. This file, not
// packages/account/tests/, is where all four writers are reachable at once
// without inverting that dependency direction.
const PUBLIC_BASE_URL = 'https://idp.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const WEAK_PASSWORD = 'weak';
const STRONG_PASSWORD = 'correct horse battery staple';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);

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

const OUTBOX_OPTIONS: SendPendingOptions = {
  batchSize: 50,
  maxAttempts: 3,
  retryBackoffSeconds: 60,
};

// A request queues its mail and answers; the pass that hands a queued
// message to a transport runs on the server's own schedule
// (apps/server/src/modules/outbox.ts). A test that wants the mailed link
// runs that pass here instead of waiting for a tick.

async function drainOutbox(into: EmailSender): Promise<void> {
  await sendPending(
    { database: appDb, ownerDatabase: owner, sender: into },
    drainAt(),
    OUTBOX_OPTIONS,
  );
}

// A message's `next_attempt_at` defaults to the database's clock, and a
// containerised Postgres can run milliseconds ahead of this process — so a
// pass given this process's own instant can find a message it queued a
// moment ago not yet due. A minute ahead is past any such skew.
function drainAt(): Date {
  return new Date(Date.now() + 60_000);
}

function buildTestApp(): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
      : {}),
  });
}

async function setRealmSettings(
  realmId: string,
  settings: {
    registrationAllowed?: boolean;
    resetPasswordAllowed?: boolean;
    passwordMaxAgeDays?: number;
  },
): Promise<void> {
  await owner.db.update(realms).set(settings).where(eq(realms.id, realmId));
}

// created_at is written by the database's own now(), so standing a password
// in the past is the only way to make the realm's maximum age bite.
async function agePassword(realmId: string, days: number): Promise<void> {
  await owner.db
    .update(userCredentials)
    .set({ createdAt: sql`now() - ${`${String(days)} days`}::interval` })
    .where(and(eq(userCredentials.realmId, realmId), eq(userCredentials.type, 'password')));
}

async function formPost(app: FastifyInstance, url: string, fields: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// The login form /authorize renders carries the id of the authentication
// session the required-action route will not act without.
async function startAuthSession(app: FastifyInstance, realmName: string): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'policy-spa',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  });
  const authorize = await app.inject({
    url: `/realms/${realmName}/protocol/openid-connect/auth?${params.toString()}`,
  });
  expect(authorize.statusCode).toBe(200);
  const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');
  return authSessionId;
}

function extractLink(message: EmailMessage): string {
  const match = /visiting this link:\n\n(\S+)/.exec(message.text);
  const link = match?.[1];
  if (link === undefined) throw new Error(`no link found in ${message.text}`);
  return link;
}

// Every test below reads either what the queue holds or what a drain
// delivered, so each starts with the queue empty rather than with whatever
// an earlier test left in it.
beforeEach(async () => {
  await owner.db.delete(emailOutbox);
});

describe('the realm password policy binds every writer', () => {
  it('refuses a weak password at registration', async () => {
    const realmName = `policy-reg-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true });

    const app = buildTestApp();
    await app.ready();
    try {
      const form = new URLSearchParams({
        username: 'ada',
        email: 'ada@example.test',
        password: WEAK_PASSWORD,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/realms/${realmName}/login-actions/registration`,
        payload: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at least');
    } finally {
      await app.close();
    }
  });

  it('refuses a weak password at reset redemption', async () => {
    const realmName = `policy-reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: STRONG_PASSWORD,
      email: 'ada@example.test',
    });
    await setRealmSettings(seeded.realmId, { resetPasswordAllowed: true });

    const sender = capturingSender();
    const app = buildApp({
      database: appDb,
      ownerDatabase: owner,
      kek: KEK,
      logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    await app.ready();
    try {
      const requestForm = new URLSearchParams({ email: 'ada@example.test' });
      const requested = await app.inject({
        method: 'POST',
        url: `/realms/${realmName}/login-actions/reset-password`,
        payload: requestForm.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(requested.statusCode).toBe(200);

      await drainOutbox(sender);
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no reset mail sent');
      const link = extractLink(message);
      const key = new URL(link).searchParams.get('key');
      if (key === null) throw new Error(`no key in ${link}`);

      const redeemForm = new URLSearchParams({ key, password: WEAK_PASSWORD });
      const res = await app.inject({
        method: 'POST',
        url: new URL(link).pathname,
        payload: redeemForm.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at least');
    } finally {
      await app.close();
    }
  });

  it('refuses a weak password from the seed CLI', async () => {
    const realmName = `policy-seed-${newId()}`;

    await expect(
      seed({
        realm: realmName,
        clientId: 'policy-spa',
        redirectUris: [REDIRECT_URI],
        username: 'ada',
        password: WEAK_PASSWORD,
        email: 'ada@example.test',
      }),
    ).rejects.toThrow(/password does not satisfy the realm's password policy/);
  });

  // The fourth writer, reached the only way it can be: the action has to be
  // owed, and the authentication session has to be bound to the subject who
  // owes it. Nothing shorter than a real login gets here — the route refuses
  // a submission whose session names nobody, and the gate refuses an action
  // the bound subject was never asked for.
  it('refuses a weak password at the change-password required action', async () => {
    const realmName = `policy-change-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: STRONG_PASSWORD,
      email: 'ada@example.test',
    });
    // A maximum age of one day against a password stood a week in the past:
    // what makes update-password owed, and the login that discovers it still
    // authenticates — the action blocks its completion, not the password.
    await setRealmSettings(seeded.realmId, { passwordMaxAgeDays: 1 });
    await agePassword(seeded.realmId, 7);

    const app = buildTestApp();
    await app.ready();
    try {
      const authSessionId = await startAuthSession(app, realmName);
      const login = await formPost(app, `/realms/${realmName}/login-actions/authenticate`, {
        auth_session_id: authSessionId,
        username: 'ada',
        password: STRONG_PASSWORD,
      });
      expect(login.statusCode).toBe(200);
      expect(login.body).toContain('Change your password');

      const res = await formPost(
        app,
        `/realms/${realmName}/login-actions/required-action?action=update-password`,
        { auth_session_id: authSessionId, password: WEAK_PASSWORD },
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at least');
      // Back to the same form, so the refusal is the policy's and not the
      // route losing the attempt.
      expect(res.body).toContain('Change your password');
    } finally {
      await app.close();
    }
  });
});

// "No maximum" and "an Argon2id verification per attempt" are one defect
// stated twice, and the login form is the reader that proves it needs
// answering at the read: that route verifies rather than evaluates. All
// four form readers and the seed CLI are exercised here; what stops a new
// reader arriving without the cap is
// tests/lint/password-read-through-kernel.test.ts, since a new route adds
// no case to this file.
describe('a password over the maximum is refused wherever one is read', () => {
  const overlong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);

  it('refuses it at registration', async () => {
    const realmName = `policy-max-reg-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true });

    const app = buildTestApp();
    await app.ready();
    try {
      const res = await formPost(app, `/realms/${realmName}/login-actions/registration`, {
        username: 'ada',
        email: 'ada@example.test',
        password: overlong,
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at most');
    } finally {
      await app.close();
    }
  });

  it('refuses it at reset redemption', async () => {
    const realmName = `policy-max-reset-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: STRONG_PASSWORD,
      email: 'ada@example.test',
    });
    await setRealmSettings(seeded.realmId, { resetPasswordAllowed: true });

    const sender = capturingSender();
    const app = buildApp({
      database: appDb,
      ownerDatabase: owner,
      kek: KEK,
      logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    await app.ready();
    try {
      const requested = await formPost(app, `/realms/${realmName}/login-actions/reset-password`, {
        email: 'ada@example.test',
      });
      expect(requested.statusCode).toBe(200);

      await drainOutbox(sender);
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no reset mail sent');
      const link = extractLink(message);
      const key = new URL(link).searchParams.get('key');
      if (key === null) throw new Error(`no key in ${link}`);

      const res = await formPost(app, new URL(link).pathname, { key, password: overlong });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at most');
    } finally {
      await app.close();
    }
  });

  it('refuses it at the login form, without verifying it', async () => {
    const realmName = `policy-max-login-${newId()}`;
    await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: STRONG_PASSWORD,
      email: 'ada@example.test',
    });

    const app = buildTestApp();
    await app.ready();
    try {
      const authSessionId = await startAuthSession(app, realmName);
      const res = await formPost(app, `/realms/${realmName}/login-actions/authenticate`, {
        auth_session_id: authSessionId,
        username: 'ada',
        password: overlong,
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at most');

      // The attempt never reached the credential, so it never counted
      // against the account either: the correct password still signs in.
      const signedIn = await formPost(app, `/realms/${realmName}/login-actions/authenticate`, {
        auth_session_id: await startAuthSession(app, realmName),
        username: 'ada',
        password: STRONG_PASSWORD,
      });
      expect(signedIn.headers.location).toContain('code=');
    } finally {
      await app.close();
    }
  });

  it('refuses it at the change-password required action', async () => {
    const realmName = `policy-max-change-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: STRONG_PASSWORD,
      email: 'ada@example.test',
    });
    await setRealmSettings(seeded.realmId, { passwordMaxAgeDays: 1 });
    await agePassword(seeded.realmId, 7);

    const app = buildTestApp();
    await app.ready();
    try {
      const authSessionId = await startAuthSession(app, realmName);
      const login = await formPost(app, `/realms/${realmName}/login-actions/authenticate`, {
        auth_session_id: authSessionId,
        username: 'ada',
        password: STRONG_PASSWORD,
      });
      expect(login.body).toContain('Change your password');

      const res = await formPost(
        app,
        `/realms/${realmName}/login-actions/required-action?action=update-password`,
        { auth_session_id: authSessionId, password: overlong },
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at most');
      expect(res.body).toContain('Change your password');
    } finally {
      await app.close();
    }
  });

  // The writer that reads no form. A password the CLI accepted and the
  // login form refused would be one nobody could ever sign in with.
  it('refuses it from the seed CLI', async () => {
    await expect(
      seed({
        realm: `policy-max-seed-${newId()}`,
        clientId: 'policy-spa',
        redirectUris: [REDIRECT_URI],
        username: 'ada',
        password: overlong,
        email: 'ada@example.test',
      }),
    ).rejects.toThrow(/password does not satisfy the realm's password policy/);
  });
});
