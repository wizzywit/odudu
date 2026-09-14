import { sendVerificationEmail } from '@odudu/account';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { capturingSender, type EmailMessage } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// This file exists because the unit-scale tests of @odudu/account's usecase
// inject a fake in-memory store for getCurrentEmail/markVerified — real by
// construction, since @odudu/account never imports @odudu/domain-identity.
// The composition that actually joins the two lives only in
// apps/server/src/app.ts, and nothing exercised it: this builds the real
// app, seeds a real user through the real seed command, redeems a real
// mailed link against it, and reads emails_verified back off both the
// users table and a decoded ID token from a real authorization-code flow —
// the claim the whole task exists to make true.

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
// RFC 7636 Appendix B's worked example, the same pair
// packages/protocol-oidc/tests/login.adversarial.int.test.ts uses.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
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
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function buildTestApp(): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    sender: capturingSender(),
  });
}

function decodeIdTokenClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split('.')[1] ?? '';
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

async function extractAuthSessionId(instance: FastifyInstance, realmName: string): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'verify-spa',
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

async function issueIdToken(instance: FastifyInstance, realmName: string): Promise<string> {
  const authSessionId = await extractAuthSessionId(instance, realmName);

  const loginForm = new URLSearchParams({
    auth_session_id: authSessionId,
    username: 'ada',
    password: PASSWORD,
  });
  const loginRes = await instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: loginForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const location = loginRes.headers.location;
  const code = typeof location === 'string' ? /[?&]code=([^&]*)/.exec(location)?.[1] : undefined;
  if (code === undefined) throw new Error(`no code in redirect: ${String(location)}`);

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: 'verify-spa',
    code_verifier: VERIFIER,
  });
  const tokenRes = await instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: tokenForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const body = tokenRes.json<{ id_token: string }>();
  return body.id_token;
}

function extractKey(message: EmailMessage): string {
  const match = /[?&]key=([^&\s]+)/.exec(message.text);
  const key = match?.[1];
  if (key === undefined) throw new Error(`no key found in ${message.text}`);
  return key;
}

describe('address verification, through the real composition root', () => {
  it('flips email_verified on the users column and in a freshly issued ID token', async () => {
    const realmName = `verify-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'verify-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: PASSWORD,
      email: EMAIL,
    });
    const userSubjectId = seeded.userSubjectId;
    if (userSubjectId === undefined) throw new Error('seed did not report a user');

    const app = buildTestApp();
    await app.ready();

    try {
      const before = decodeIdTokenClaims(await issueIdToken(app, realmName));
      expect(before.email_verified).toBe(false);

      const sender = capturingSender();
      await sendVerificationEmail(
        {
          database: appDb,
          sender,
          realmId: seeded.realmId,
          realmName,
          realmDisplayName: realmName,
          issuerBase: 'https://idp.example.test',
        },
        { subjectId: userSubjectId, email: EMAIL },
      );
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no mail sent');
      const key = extractKey(message);

      const redeemRes = await app.inject({
        method: 'GET',
        url: `/realms/${realmName}/login-actions/action-token?key=${key}`,
      });
      expect(redeemRes.statusCode).toBe(200);

      const columnAfter = await withRealm(appDb.db, seeded.realmId, (tx) =>
        userRepository(tx).bySubjectId(userSubjectId),
      );
      expect(columnAfter?.emailVerified).toBe(true);

      const after = decodeIdTokenClaims(await issueIdToken(app, realmName));
      expect(after.email_verified).toBe(true);
      expect(after.email).toBe(EMAIL);
    } finally {
      await app.close();
    }
  });
});
