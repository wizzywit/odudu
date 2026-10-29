import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { capturingSender, sendPending, type EmailSender } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { mintAdminToken } from '#/testing/plan-admin-drives';
import { seed } from '#/cli/seed';
import { isWork, StatementRecorder } from '#/testing/plan-capture';

// The real composition root and a real PostgreSQL: a tenant's wording for a
// mail message is read in the transaction the mail is queued in, and applied
// where the text is composed.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
const recorder = new StatementRecorder();

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const EMAIL = 'ada@example.test';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5, onQueryForTests: recorder.hook('app') });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: pino({ level: 'silent' }),
    tls: false,
    publicBaseUrl: BASE,
    deploymentSmtp: true,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  name: string;
  tenantId: string;
  token: string;
}

async function world(locale?: string): Promise<World> {
  const name = `wording-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple',
    email: EMAIL,
  });
  await owner.db
    .update(tenants)
    .set({
      resetPasswordAllowed: true,
      ...(locale === undefined ? {} : { supportedLocales: ['en', locale], defaultLocale: locale }),
    })
    .where(eq(tenants.id, seeded.tenantId));
  const token = await mintAdminToken({ http: app, app: appDb }, { id: seeded.tenantId, name }, [
    'manage-tenant',
  ]);
  return { name, tenantId: seeded.tenantId, token };
}

function admin(w: World, method: 'GET' | 'PUT', path: string, body?: unknown) {
  return app.inject({
    method,
    url: `/admin/tenants/${w.name}${path}`,
    headers: {
      authorization: `Bearer ${w.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

async function override(w: World, locale: string, key: string, message: string) {
  return admin(w, 'PUT', `/message-overrides/${locale}/${key}`, { message });
}

async function requestReset(w: World, email: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/login-actions/reset-password`,
    payload: new URLSearchParams({ email }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
}

async function drain() {
  const into = capturingSender();
  const sender: EmailSender = into;
  await sendPending(
    { database: appDb, ownerDatabase: owner, resolveSender: () => Promise.resolve(sender) },
    new Date(),
    { batchSize: 50, maxAttempts: 3, retryBackoffSeconds: 60 },
  );
  return into.sent;
}

describe('which keys an override may name', () => {
  it('lists the mail messages as a section of their own, with no page kinds', async () => {
    const w = await world();
    const { sections } = (await admin(w, 'GET', '/message-catalogue')).json<{
      sections: { kinds: string[]; messages: { key: string; en: string }[] }[];
    }>();
    const mail = sections.filter((section) => section.kinds.length === 0);
    expect(mail).toHaveLength(1);
    const keys = mail[0]?.messages.map((message) => message.key) ?? [];
    expect(keys).toContain('reset.subject');
    expect(keys).toContain('mail.notRequested');
  });

  it('accepts a mail key and holds it to the arguments the mail supplies', async () => {
    const w = await world();
    expect((await override(w, 'en', 'reset.heading', 'Pick a new one')).statusCode).toBe(200);
    expect((await override(w, 'en', 'reset.subject', 'For {tenant}')).statusCode).toBe(200);
    const refused = await override(w, 'en', 'reset.subject', 'For {nobody}');
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('{nobody}');
    expect((await override(w, 'en', 'reset.nonesuch', 'x')).statusCode).toBe(400);
  });
});

describe('a mail queued for a tenant with its own wording', () => {
  it('says the override in both parts, keeping the link and what it did not override', async () => {
    const w = await world();
    await override(w, 'en', 'reset.subject', 'Acme: reset for {tenant}');
    await override(w, 'en', 'reset.heading', 'Pick a new Acme password');
    await override(w, 'en', 'reset.button', 'Reset it');
    await requestReset(w, EMAIL);
    const [mail] = await drain();
    expect(mail?.subject).toBe(`Acme: reset for ${w.name}`);
    expect(mail?.html).toContain('Pick a new Acme password');
    expect(mail?.html).toContain('>Reset it<');
    expect(mail?.text).toContain('/login-actions/action-token?key=');
    expect(mail?.html).toContain('If you did not request this');
  });

  it('is in the tenant default language’s wording when the recipient has none', async () => {
    const w = await world('ar');
    await override(w, 'ar', 'reset.heading', 'عنوان خاص');
    await override(w, 'en', 'reset.heading', 'English only');
    await requestReset(w, EMAIL);
    const [mail] = await drain();
    expect(mail?.html).toContain('عنوان خاص');
    expect(mail?.html).not.toContain('English only');
  });

  it('shows a hostile override as text', async () => {
    const w = await world();
    await override(w, 'en', 'reset.body', '<script>alert(1)</script> &amp; for {tenant}');
    await requestReset(w, EMAIL);
    const [mail] = await drain();
    expect(mail?.html).not.toContain('<script>');
    expect(mail?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp; for');
  });

  it('shows the same override in the preview an administrator reads', async () => {
    const w = await world();
    await override(w, 'en', 'verify.heading', 'Confirm you are you');
    const res = await admin(w, 'GET', '/mail/preview');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('Confirm you are you');
  });
});

describe('what the wording costs a mail request', () => {
  async function statementsOf(w: World, email: string): Promise<number> {
    const { statements } = await recorder.record(() => requestReset(w, email));
    // Savepoints are statements the database runs too.
    return statements.filter((s) => isWork(s) || /^(savepoint|release)\b/iu.test(s.query.trim()))
      .length;
  }

  it('is the same for an address with an account and one without, with or without overrides', async () => {
    const plain = await world();
    const worded = await world();
    for (const [key, message] of [
      ['reset.subject', 'A {tenant}'],
      ['reset.heading', 'B'],
      ['reset.body', 'C {tenant}'],
      ['verify.heading', 'D'],
    ] as const) {
      await override(worded, 'en', key, message);
    }
    await override(worded, 'ar', 'reset.heading', 'E');
    const unknownPlain = await statementsOf(plain, 'nobody@example.test');
    const unknownWorded = await statementsOf(worded, 'nobody@example.test');
    const knownPlain = await statementsOf(plain, EMAIL);
    const knownWorded = await statementsOf(worded, EMAIL);
    // One read for every language, made whatever the tenant holds.
    expect(unknownWorded).toBe(unknownPlain);
    expect(knownWorded).toBe(knownPlain);
    // An unknown address costs what a known one does apart from the token and the mail.
    expect(knownWorded - unknownWorded).toBe(knownPlain - unknownPlain);
  });
});
