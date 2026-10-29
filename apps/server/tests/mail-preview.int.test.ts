import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { emailOutbox } from '@odudu/email';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, makePng, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq, sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { mintAdminToken } from '#/testing/plan-admin-drives';
import { createBranding, type Branding } from '#/branding';
import { seed } from '#/cli/seed';
import { isWork, StatementRecorder } from '#/testing/plan-capture';

// The real composition root and a real PostgreSQL: the mail preview is the
// mail a published theme would dress, never a draft, and it writes nothing.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let branding: Branding;
const recorder = new StatementRecorder();

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
const NIGHT = {
  surfacePage: '#101010',
  surfacePanel: '#181818',
  surfaceSunken: '#0c0c0c',
  inkPrimary: '#f0f0f0',
  inkMuted: '#b0b0b0',
  signalActive: '#223322',
  signalActiveInk: '#aaffaa',
  signalDanger: '#401000',
  signalDangerInk: '#ffb090',
  borderStrong: '#999999',
  focusRing: '#66aaff',
};
const WARM = { ...LIGHT, surfacePage: '#fff4e0', surfacePanel: '#fffaf0' };

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

async function token(w: World, capabilities: string[] = ['manage-tenant']): Promise<string> {
  return mintAdminToken({ http: app, app: appDb }, { id: w.tenantId, name: w.name }, capabilities);
}

async function get(w: World, path: string, bearer?: string) {
  return app.inject({
    method: 'GET',
    url: `/admin/tenants/${w.name}${path}`,
    headers: { authorization: `Bearer ${bearer ?? (await token(w))}` },
  });
}

// Measured with the theme's cache emptied: the caller's own checks, the
// published theme's read, the tenant's row and its overrides (one read in a
// savepoint, for every language). It must not grow with a theme or wording.
const MAIL_STATEMENTS = 10;

const header = (res: { headers: Record<string, unknown> }, name: string): string =>
  String(res.headers[name]);

describe('the mail preview', () => {
  it('shows the verification mail of the published theme, light and dark', async () => {
    const w = await world();
    const logo = await putLogo(w, { width: 480, height: 96 });
    await publish(
      w,
      theme({
        tokens: { light: LIGHT, dark: NIGHT },
        assets: { logo: { assetId: logo.id, alt: 'Acme logo' } },
      }),
    );
    const light = await get(w, '/mail/preview?scheme=light');
    expect(light.statusCode, light.body).toBe(200);
    expect(header(light, 'content-type')).toMatch(/^text\/html/u);
    expect(light.body).toContain(logo.url);
    expect(light.body).toContain('#fafafa');
    expect(light.body).not.toContain('#101010');
    const dark = await get(w, '/mail/preview?scheme=dark');
    expect(dark.body).toContain('#101010');
    expect(dark.body).not.toContain('#fafafa');
  });

  it('shows the default mail, with its mark as a picture, for a tenant with no theme', async () => {
    const w = await world();
    const res = await get(w, '/mail/preview');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('#e7eae9');
    expect(res.body).toContain('data:image/png;base64,');
    expect(res.body).not.toContain('cid:');
  });

  it('never shows a draft', async () => {
    const w = await world();
    await withTenant(appDb.db, w.tenantId, (tx) =>
      themeRepository(tx).saveDraft(
        { tenantId: w.tenantId, clientId: null },
        theme({ tokens: { light: WARM } }),
        null,
      ),
    );
    expect((await get(w, '/mail/preview')).body).not.toContain('#fff4e0');
  });

  it('is in the language asked for, else the tenant default, else English', async () => {
    const w = await world('ar');
    expect((await get(w, '/mail/preview?locale=en')).body).toContain('lang="en"');
    expect((await get(w, '/mail/preview')).body).toContain('dir="rtl"');
    expect((await get(await world(), '/mail/preview')).body).toContain('lang="en"');
  });

  it('refuses a language, a kind or a parameter it does not know', async () => {
    const w = await world();
    for (const query of ['?locale=zz', '?kind=reset', '?client=x']) {
      expect((await get(w, `/mail/preview${query}`)).statusCode, query).toBe(400);
    }
  });

  it('writes nothing', async () => {
    const w = await world();
    const count = async (): Promise<number> =>
      (await owner.db.select({ n: sql<number>`count(*)::int` }).from(emailOutbox))[0]?.n ?? -1;
    const before = await count();
    await get(w, '/mail/preview');
    await get(w, '/mail/branding');
    expect(await count()).toBe(before);
  });

  it('is framed by this origin only, licenses no script and images from the logo origin', async () => {
    const w = await world();
    const logo = await putLogo(w, { width: 64, height: 64 });
    await publish(w, theme({ assets: { logo: { assetId: logo.id, alt: 'Acme' } } }));
    const res = await get(w, '/mail/preview');
    const policy = header(res, 'content-security-policy');
    expect(policy.split('; ')).toContain("frame-ancestors 'self'");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`img-src data: ${new URL(BASE).origin}`);
    expect(policy).not.toContain('script-src');
    expect(header(res, 'cache-control')).toBe('no-store');
    expect(header(res, 'referrer-policy')).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('needs manage-tenant, and answers for the caller’s own tenant only', async () => {
    const w = await world();
    const other = await world();
    const weak = await token(w, ['manage-clients']);
    expect((await get(w, '/mail/preview', weak)).statusCode).toBe(403);
    expect((await get(w, '/mail/branding', weak)).statusCode).toBe(403);
    const foreign = await token(other);
    expect((await get(w, '/mail/preview', foreign)).statusCode).toBe(401);
    expect((await get(w, '/mail/branding', foreign)).statusCode).toBe(401);
  });
});

describe('the branding a mail inherits', () => {
  it('names the layer of each palette and the logos, and the default for what is not set', async () => {
    const w = await world();
    const logo = await putLogo(w, { width: 480, height: 96 });
    await publish(
      w,
      theme({ tokens: { light: LIGHT }, assets: { logo: { assetId: logo.id, alt: 'Acme logo' } } }),
    );
    const res = await get(w, '/mail/branding');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      light: { source: string; colours: Record<string, string> };
      dark: { source: string; colours: Record<string, string> };
      logo: { src: string; alt: string } | null;
      dark_logo: unknown;
    }>();
    expect(body.light.source).toBe('tenant');
    expect(body.light.colours.panel).toBe('#fafafa');
    expect(Object.keys(body.light.colours)).toHaveLength(9);
    expect(body.dark.source).toBe('default');
    expect(body.logo).toMatchObject({ src: logo.url, alt: 'Acme logo' });
    expect(body.dark_logo).toBeNull();
  });

  it('is all default for a tenant with no theme', async () => {
    const res = await get(await world(), '/mail/branding');
    expect(res.json()).toMatchObject({
      light: { source: 'default' },
      dark: { source: 'default' },
      logo: null,
      dark_logo: null,
    });
  });
});

describe('what a preview costs', () => {
  async function statementsFor(w: World, path: string): Promise<number> {
    branding.invalidateTenant(w.tenantId);
    const bearer = await token(w);
    const { result, statements } = await recorder.record(() => get(w, path, bearer));
    expect(result.statusCode).toBe(200);
    return statements.filter(isWork).length;
  }

  it('is the same few statements for a theme naming two logos as for no theme', async () => {
    const bare = await world();
    const named = await world();
    const light = await putLogo(named, { width: 480, height: 96 });
    const dark = await putLogo(named, { width: 100, height: 100 });
    await publish(
      named,
      theme({
        tokens: { light: LIGHT, dark: NIGHT },
        assets: {
          logo: { assetId: light.id, alt: 'Acme' },
          darkLogo: { assetId: dark.id, alt: 'Acme dark' },
        },
      }),
    );
    for (const path of ['/mail/preview', '/mail/branding']) {
      const none = await statementsFor(bare, path);
      const two = await statementsFor(named, path);
      expect(two, path).toBe(none);
      expect(two, path).toBeLessThanOrEqual(MAIL_STATEMENTS);
    }
  });
});
