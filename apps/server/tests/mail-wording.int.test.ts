import { networkInterfaces } from 'node:os';
import { createServer, type Server } from 'node:net';
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { capturingSender, sendPending, type EmailSender } from '@odudu/email';
import { clients } from '@odudu/domain-tenant';
import { themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createBranding, type Branding } from '#/branding';
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
let branding: Branding;
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
  const logger = pino({ level: 'silent' });
  branding = createBranding({ database: appDb, logger, publicBaseUrl: BASE });
  app = buildApp({
    branding,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: false,
    publicBaseUrl: BASE,
    deploymentSmtp: true,
    allowPrivateSmtpHosts: true,
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

function admin(
  w: World,
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url: `/admin/tenants/${w.name}${path}`,
    headers: {
      authorization: `Bearer ${w.token}`,
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

async function override(w: World, locale: string, key: string, message: string) {
  const held = (await admin(w, 'GET', `/message-overrides?locale=${locale}`)).json<{
    items: { key: string; etag: string }[];
  }>().items;
  const etag = held.find((item) => item.key === key)?.etag;
  return admin(
    w,
    'PUT',
    `/message-overrides/${locale}/${key}`,
    { message },
    etag === undefined ? { 'if-none-match': '*' } : { 'if-match': etag },
  );
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

// A relay that takes one message and keeps what it was sent.
function fakeRelay(): Promise<{ server: Server; port: number; received: Promise<string> }> {
  return new Promise((resolve) => {
    let done: (data: string) => void = () => undefined;
    const received = new Promise<string>((r) => {
      done = r;
    });
    const server = createServer((socket) => {
      let data = '';
      let inData = false;
      socket.write('220 relay ready\r\n');
      socket.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        if (inData) {
          data += text;
          if (data.endsWith('\r\n.\r\n')) {
            inData = false;
            done(data);
            socket.write('250 queued\r\n');
          }
          return;
        }
        for (const line of text.split('\r\n').filter((l) => l !== '')) {
          const verb = line.slice(0, 4).toUpperCase();
          if (verb === 'EHLO' || verb === 'HELO') socket.write('250 relay\r\n');
          else if (verb === 'DATA') {
            inData = true;
            socket.write('354 go\r\n');
          } else if (verb === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address !== null ? address.port : 0,
        received,
      });
    });
  });
}

// The relay may not be loopback (the route refuses it), so it listens on the
// host's own private address. A hosted runner has one on its network
// interface, and a host without one fails the first test below by name
// instead of skipping the rest.
function privateAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find(
      (entry) =>
        entry?.family === 'IPv4' &&
        !entry.internal &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(entry.address),
    )?.address;
}

async function publishTheme(
  w: World,
  tokens: ThemeBody['tokens'],
  clientRowId: string | null = null,
): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId: clientRowId };
    const body: ThemeBody = { tokens, stylesheet: null, templates: {}, assets: {} };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
  branding.invalidateTenant(w.tenantId);
}

async function portalRowId(w: World): Promise<string> {
  const [row] = await owner.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, w.tenantId), eq(clients.clientId, 'portal')));
  if (row === undefined) throw new Error('no portal client');
  return row.id;
}

async function relayTo(w: World, relay: { port: number }) {
  const put = await admin(w, 'PUT', '/smtp', {
    host: privateAddress(),
    port: relay.port,
    from_address: 'noreply@example.test',
    starttls: false,
  });
  expect(put.statusCode, put.body).toBe(200);
}

function sendTest(w: World, clientId?: string, token = w.token) {
  return app.inject({
    method: 'POST',
    url: `/admin/tenants/${w.name}/smtp/test`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { to: 'ops@example.test', ...(clientId === undefined ? {} : { client_id: clientId }) },
  });
}

function unquote(raw: string): string {
  return raw
    .replaceAll('=\r\n', '')
    .replace(/=([0-9A-F]{2})/gu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

describe('the SMTP test mail', () => {
  it('has a private IPv4 address to run a relay on', () => {
    expect(privateAddress(), 'no non-loopback private IPv4 address on this host').toBeDefined();
  });

  it('carries a stored smtpTest override in the message the relay receives', async () => {
    const w = await world();
    expect((await override(w, 'en', 'smtpTest.subject', 'Acme relay check')).statusCode).toBe(200);
    expect((await override(w, 'en', 'smtpTest.heading', 'The Acme relay works')).statusCode).toBe(
      200,
    );
    const relay = await fakeRelay();
    try {
      const put = await admin(w, 'PUT', '/smtp', {
        host: privateAddress(),
        port: relay.port,
        from_address: 'noreply@example.test',
        starttls: false,
      });
      expect(put.statusCode, put.body).toBe(200);
      const sent = await app.inject({
        method: 'POST',
        url: `/admin/tenants/${w.name}/smtp/test`,
        headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
        payload: { to: 'ops@example.test' },
      });
      expect(sent.statusCode, sent.body).toBe(200);
      const message = unquote(await relay.received);
      expect(message).toContain('Subject: Acme relay check');
      expect(message).toContain('The Acme relay works');
    } finally {
      relay.server.close();
    }
  });

  it('wears the tenant’s published theme, at the cost of the statements a themeless one takes', async () => {
    const themed = await world();
    const plain = await world();
    const light = {
      surfacePage: '#ffffff',
      surfacePanel: '#fff4e0',
      surfaceSunken: '#f0f0f0',
      inkPrimary: '#111111',
      inkMuted: '#555555',
      signalActive: '#ddeedd',
      signalActiveInk: '#004400',
      signalDanger: '#fde0d0',
      signalDangerInk: '#802000',
      borderStrong: '#777777',
      focusRing: '#0044aa',
    };
    await publishTheme(themed, { light });
    const counts: number[] = [];
    const bodies: string[] = [];
    for (const w of [themed, plain]) {
      const relay = await fakeRelay();
      try {
        await relayTo(w, relay);
        branding.invalidateTenant(w.tenantId);
        const { result, statements } = await recorder.record(() => sendTest(w));
        expect(result.statusCode, result.body).toBe(200);
        counts.push(
          statements.filter((s) => isWork(s) || /^(savepoint|release)\b/iu.test(s.query.trim()))
            .length,
        );
        bodies.push(unquote(await relay.received));
      } finally {
        relay.server.close();
      }
    }
    expect(bodies[0]).toContain('#fff4e0');
    expect(bodies[1]).not.toContain('#fff4e0');
    expect(bodies[1]).toContain('#e7eae9');
    expect(counts[0]).toBe(counts[1]);
  });

  it('wears the chosen client’s theme over the tenant’s, and the tenant’s without one', async () => {
    const w = await world();
    const warm = {
      surfacePage: '#ffffff',
      surfacePanel: '#fff4e0',
      surfaceSunken: '#f0f0f0',
      inkPrimary: '#111111',
      inkMuted: '#555555',
      signalActive: '#ddeedd',
      signalActiveInk: '#004400',
      signalDanger: '#fde0d0',
      signalDangerInk: '#802000',
      borderStrong: '#777777',
      focusRing: '#0044aa',
    };
    await publishTheme(w, { light: warm });
    await publishTheme(w, { light: { ...warm, surfacePanel: '#e0f0ff' } }, await portalRowId(w));
    const relay = await fakeRelay();
    try {
      await relayTo(w, relay);
      const both = await mintAdminToken(
        { http: app, app: appDb },
        { id: w.tenantId, name: w.name },
        ['manage-tenant', 'manage-clients'],
      );
      const res = await sendTest(w, await portalRowId(w), both);
      expect(res.statusCode, res.body).toBe(200);
      const message = unquote(await relay.received);
      expect(message).toContain('#e0f0ff');
      expect(message).not.toContain('#fff4e0');
    } finally {
      relay.server.close();
    }
  });
});
