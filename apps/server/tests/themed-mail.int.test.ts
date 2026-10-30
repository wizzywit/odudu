import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { capturingSender, sendPending, type EmailSender } from '@odudu/email';
import { users } from '@odudu/domain-identity';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, makePng, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { mintAdminToken } from '#/testing/plan-admin-drives';
import { createBranding, type Branding } from '#/branding';
import { seed } from '#/cli/seed';

// The real composition root and a real PostgreSQL: a mail is themed when it
// is queued, the outbox row keeps the result, and a theme published after
// that moment changes the next mail and not this one.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let branding: Branding;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const EMAIL = 'ada@example.test';
const TENANT_CAP = 8 * 1024 * 1024;
const LIGHT = {
  surfacePage: '#ffffff',
  surfacePanel: '#fafafa',
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
const WARM = { ...LIGHT, surfacePage: '#fff4e0', surfacePanel: '#fffaf0' };

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = pino({ level: 'silent' });
  branding = createBranding({ database: appDb, logger, publicBaseUrl: BASE });
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: false,
    publicBaseUrl: BASE,
    deploymentSmtp: true,
    branding,
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
}

async function world(locale?: string): Promise<World> {
  const name = `mail-${newId()}`;
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
  return { name, tenantId: seeded.tenantId };
}

async function putLogo(w: World, size: { width: number; height: number }) {
  const bytes = makePng(size);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await withTenant(appDb.db, w.tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId: w.tenantId,
      sha256,
      mime: 'image/png',
      ...size,
      bytes,
      tenantCapBytes: TENANT_CAP,
    }),
  );
  if (stored === 'over_cap') throw new Error('over cap');
  return { id: stored.id, url: `${BASE}/tenants/${w.name}/brand/${sha256}.png` };
}

async function publish(w: World, themeBody: ThemeBody): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId: null };
    await themes.saveDraft(scope, themeBody, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
  branding.invalidateTenant(w.tenantId);
}

function theme(parts: Partial<ThemeBody>): ThemeBody {
  return { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...parts };
}

async function requestReset(w: World): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/login-actions/reset-password`,
    payload: new URLSearchParams({ email: EMAIL }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
}

async function drain(): Promise<ReturnType<typeof capturingSender>> {
  const into = capturingSender();
  const sender: EmailSender = into;
  await sendPending(
    { database: appDb, ownerDatabase: owner, resolveSender: () => Promise.resolve(sender) },
    new Date(),
    { batchSize: 50, maxAttempts: 3, retryBackoffSeconds: 60 },
  );
  return into;
}

describe('a mail queued under a published theme', () => {
  it('wears its palette and logo, and keeps them when a later publish replaces them', async () => {
    const w = await world();
    const first = await putLogo(w, { width: 480, height: 96 });
    await publish(
      w,
      theme({
        tokens: { light: LIGHT },
        assets: { logo: { assetId: first.id, alt: 'Acme logo' } },
      }),
    );
    await requestReset(w);

    const second = await putLogo(w, { width: 100, height: 100 });
    await publish(
      w,
      theme({ tokens: { light: WARM }, assets: { logo: { assetId: second.id, alt: 'New logo' } } }),
    );

    const sent = (await drain()).sent;
    expect(sent).toHaveLength(1);
    const html = sent[0]?.html ?? '';
    expect(html).toContain(first.url);
    expect(html).toContain('width="160" height="32" alt="Acme logo"');
    expect(html).toContain('#fafafa');
    expect(html).not.toContain(second.url);
    expect(html).not.toContain('#fff4e0');

    expect((await app.inject({ url: new URL(first.url).pathname })).statusCode).toBe(404);
    expect((await app.inject({ url: new URL(second.url).pathname })).statusCode).toBe(200);

    await requestReset(w);
    const next = (await drain()).sent[0]?.html ?? '';
    expect(next).toContain(second.url);
    expect(next).toContain('#fff4e0');
  });

  it('serves the logo a mail names while the theme that names it is published', async () => {
    const w = await world();
    const logo = await putLogo(w, { width: 64, height: 64 });
    await publish(w, theme({ assets: { logo: { assetId: logo.id, alt: 'Acme' } } }));
    await requestReset(w);
    const html = (await drain()).sent[0]?.html ?? '';
    const src = /<img src="([^"]+)"/u.exec(html)?.[1] ?? '';
    expect(src).toBe(logo.url);
    const served = await app.inject({ url: new URL(src).pathname });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
  });

  it('is unthemed for a tenant with no published theme', async () => {
    const w = await world();
    await requestReset(w);
    const html = (await drain()).sent[0]?.html ?? '';
    expect(html).toContain('cid:odudu-mark');
    expect(html).toContain('#e7eae9');
  });

  it('never wears a draft', async () => {
    const w = await world();
    await withTenant(appDb.db, w.tenantId, (tx) =>
      themeRepository(tx).saveDraft(
        { tenantId: w.tenantId, clientId: null },
        theme({ tokens: { light: WARM } }),
        null,
      ),
    );
    await requestReset(w);
    expect((await drain()).sent[0]?.html).not.toContain('#fff4e0');
  });

  it('is in the tenant default language when the recipient has none', async () => {
    const w = await world('ar');
    await requestReset(w);
    const html = (await drain()).sent[0]?.html ?? '';
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  it("also themes the mail an administrator's resend queues, through the same write", async () => {
    const w = await world();
    await publish(w, theme({ tokens: { light: WARM } }));
    const [user] = await withTenant(appDb.db, w.tenantId, (tx) =>
      tx.select({ subjectId: users.subjectId }).from(users),
    );
    const token = await mintAdminToken(
      { http: app, app: appDb },
      { id: w.tenantId, name: w.name },
      ['manage-users'],
    );
    const res = await app.inject({
      method: 'POST',
      url: `/admin/tenants/${w.name}/subjects/${user?.subjectId ?? ''}/verification`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.body).toBe(202);
    expect((await drain()).sent[0]?.html).toContain('#fff4e0');
  });

  it('queues reset and registration mail unthemed when the theme cannot be had', async () => {
    const broken = buildApp({
      database: appDb,
      ownerDatabase: owner,
      kek: KEK,
      logger: pino({ level: 'silent' }),
      tls: false,
      publicBaseUrl: BASE,
      branding: { ...branding, resolveMailBranding: () => Promise.reject(new Error('down')) },
      throttle: { limit: 100_000, windowSeconds: 60 },
    });
    await broken.ready();
    try {
      const w = await world();
      await owner.db
        .update(tenants)
        .set({ verifyEmail: true, registrationAllowed: true })
        .where(eq(tenants.id, w.tenantId));
      const form = { 'content-type': 'application/x-www-form-urlencoded' };
      const reset = await broken.inject({
        method: 'POST',
        url: `/tenants/${w.name}/login-actions/reset-password`,
        payload: new URLSearchParams({ email: EMAIL }).toString(),
        headers: form,
      });
      const registered = await broken.inject({
        method: 'POST',
        url: `/tenants/${w.name}/login-actions/registration`,
        payload: new URLSearchParams({
          username: 'grace',
          email: 'grace@example.test',
          password: 'correct horse battery staple',
          password_confirm: 'correct horse battery staple',
        }).toString(),
        headers: form,
      });
      expect([reset.statusCode, registered.statusCode]).toEqual([200, 201]);
      const sent = (await drain()).sent;
      expect(sent).toHaveLength(2);
      for (const message of sent) expect(message.html).toContain('cid:odudu-mark');
    } finally {
      await broken.close();
    }
  });
});
