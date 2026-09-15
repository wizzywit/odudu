import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  type DatabaseHandle,
} from '@odudu/db';
import { capturingSender, type EmailMessage } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

function buildTestApp(): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    sender: capturingSender(),
    ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
      : {}),
  });
}

async function setRealmSettings(
  realmId: string,
  settings: { registrationAllowed?: boolean; resetPasswordAllowed?: boolean },
): Promise<void> {
  await owner.db.update(realms).set(settings).where(eq(realms.id, realmId));
}

function extractLink(message: EmailMessage): string {
  const match = /visiting this link:\n\n(\S+)/.exec(message.text);
  const link = match?.[1];
  if (link === undefined) throw new Error(`no link found in ${message.text}`);
  return link;
}

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
      password: 'correct horse battery staple',
      email: 'ada@example.test',
    });
    await setRealmSettings(seeded.realmId, { resetPasswordAllowed: true });

    const sender = capturingSender();
    const app = buildApp({
      database: appDb,
      ownerDatabase: owner,
      kek: KEK,
      logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
      sender,
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

  // The change-password required action — the fourth writer of a password —
  // does not exist yet. `it.fails` keeps this visibly failing rather than
  // silently skipped until a later change wires a real route here and
  // turns it into a plain `it`.
  it.fails('refuses a weak password at the change-password required action', async () => {
    const realmName = `policy-change-${newId()}`;
    const seeded = await seed({
      realm: realmName,
      clientId: 'policy-spa',
      redirectUris: [REDIRECT_URI],
      username: 'ada',
      password: 'correct horse battery staple',
      email: 'ada@example.test',
    });
    await setRealmSettings(seeded.realmId, { registrationAllowed: true });

    const app = buildTestApp();
    await app.ready();
    try {
      // Refuses (404) today: nothing has registered this route yet.
      const form = new URLSearchParams({ password: WEAK_PASSWORD });
      const res = await app.inject({
        method: 'POST',
        url: `/realms/${realmName}/login-actions/required-action?action=update-password`,
        payload: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('at least');
    } finally {
      await app.close();
    }
  });
});
