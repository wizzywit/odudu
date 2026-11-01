import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { clients, messageOverrideRepository } from '@odudu/domain-tenant';
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
import { isWork, StatementRecorder } from '#/testing/plan-capture';

// The real composition root and a real PostgreSQL: what the console's branding
// reads cost, counted in statements, and what they say about a theme.

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
  const name = `reads-${newId()}`;
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

// The caller's own checks and the reads the route makes. Neither route may
// grow with what a theme names or what a tenant has written.
const CATALOGUE_STATEMENTS = 6;
const HOOKS_STATEMENTS = 6;
const INFO_STATEMENTS = 9;
const CLIENT_THEME_STATEMENTS = 10;
const CLIENT_READ_STATEMENTS = 9;
const CONTENT_STATEMENTS = 7;
const THEME_READ_STATEMENTS = 8;
const DISCARD_STATEMENTS = 13;
const CLIENT_DISCARD_STATEMENTS = 15;

async function statementsFor(w: World, path: string, capabilities?: string[]): Promise<number> {
  branding.invalidateTenant(w.tenantId);
  const bearer = await token(w, capabilities);
  const { result, statements } = await recorder.record(() => get(w, path, bearer));
  expect(result.statusCode, result.body).toBe(200);
  return statements.filter(isWork).length;
}

async function draftOnly(w: World, themeBody: ThemeBody, clientPath?: string): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const clientId = clientPath === undefined ? null : (clientPath.split('/')[2] ?? null);
    const scope = { tenantId: w.tenantId, clientId };
    await themes.saveDraft(scope, themeBody, (await themes.draft(scope))?.etag ?? null);
  });
}

describe('which pieces of a draft differ', () => {
  const ALL = theme({
    tokens: { light: LIGHT, dark: NIGHT },
    stylesheet: '.page { color: red; }',
    templates: {
      'sign-in':
        '<div>{{t "login.title"}}{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>',
    },
  });

  it('costs the same few statements whatever the draft differs in', async () => {
    const none = await world();
    const one = await world();
    const every = await world();
    await publish(none, theme({}));
    await draftOnly(one, theme({ stylesheet: '.a { }' }));
    await draftOnly(every, ALL);
    const base = await statementsFor(none, '/theme');
    const single = await statementsFor(one, '/theme');
    const all = await statementsFor(every, '/theme');
    expect(single).toBe(all);
    expect(all).toBeLessThanOrEqual(THEME_READ_STATEMENTS);
    expect(base).toBeLessThanOrEqual(all);
  });

  it('is empty for the tenant’s draft when only another tenant’s differs', async () => {
    const mine = await world();
    const theirs = await world();
    await draftOnly(theirs, ALL);
    await draftOnly(mine, theme({}));
    const view = (await get(mine, '/theme')).json<{ changed: string[] }>();
    expect(view.changed).toEqual([]);
    const theirView = (await get(theirs, '/theme')).json<{ changed: string[] }>();
    expect(theirView.changed).toEqual(['tokens', 'stylesheet', 'templates']);
  });
});

describe('discarding a draft', () => {
  async function discardStatements(w: World, path: string, body: ThemeBody): Promise<number> {
    const [theme, draft] = [path, `${path}/draft`];
    await draftOnly(w, body, path.startsWith('/clients') ? path : undefined);
    const bearer = await token(w, ['manage-tenant', 'manage-clients']);
    const current = await get(w, theme, bearer);
    const etag = String(current.headers.etag);
    const { result, statements } = await recorder.record(() =>
      app.inject({
        method: 'DELETE',
        url: `/admin/tenants/${w.name}${draft}`,
        headers: { authorization: `Bearer ${bearer}`, 'if-match': etag },
      }),
    );
    expect(result.statusCode, result.body).toBe(200);
    return statements.filter(isWork).length;
  }

  it('costs the same few statements whatever the draft names', async () => {
    const small = await world();
    const large = await world();
    const logo = await putLogo(large, { width: 16, height: 16 });
    const few = await discardStatements(small, '/theme', theme({ stylesheet: '.a { }' }));
    const many = await discardStatements(
      large,
      '/theme',
      theme({
        tokens: { light: LIGHT, dark: NIGHT },
        stylesheet: '.a { }',
        assets: { logo: { assetId: logo.id, alt: 'Acme' } },
      }),
    );
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(DISCARD_STATEMENTS);
  });

  it('costs a client’s draft the same few statements, two for the client', async () => {
    const w = await world();
    const path = await clientPath(w);
    const statements = await discardStatements(w, path, theme({ stylesheet: '.a { }' }));
    expect(statements).toBeLessThanOrEqual(CLIENT_DISCARD_STATEMENTS);
  });

  it('leaves another tenant’s draft where it is, whatever the caller names', async () => {
    const mine = await world();
    const theirs = await world();
    await draftOnly(theirs, theme({ stylesheet: '.theirs { }' }));
    const etag = String((await get(theirs, '/theme')).headers.etag);
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/tenants/${theirs.name}/theme/draft`,
      headers: { authorization: `Bearer ${await token(mine)}`, 'if-match': etag },
    });
    expect(res.statusCode).toBe(401);
    expect((await get(theirs, '/theme')).json<{ draft: unknown }>().draft).not.toBeNull();
  });
});

describe('the message catalogue', () => {
  it('reads nothing a tenant holds: the same few statements with overrides as without', async () => {
    const bare = await world();
    const written = await world();
    await withTenant(appDb.db, written.tenantId, async (tx) => {
      const overrides = messageOverrideRepository(tx, { isKnownKey: () => true });
      for (const key of ['login.title', 'login.submit', 'error.title']) {
        await overrides.put({ tenantId: written.tenantId, locale: 'en', key, message: 'x' });
      }
    });
    const none = await statementsFor(bare, '/message-catalogue');
    const some = await statementsFor(written, '/message-catalogue');
    expect(some).toBe(none);
    expect(some).toBeLessThanOrEqual(CATALOGUE_STATEMENTS);
  });

  it('is a few hundred messages in well under 100 KB, whatever the tenant', async () => {
    const w = await world();
    const res = await get(w, '/message-catalogue');
    expect(res.body.length).toBeLessThan(100_000);
    const { sections } = res.json<{ sections: { messages: unknown[] }[] }>();
    const count = sections.reduce((total, section) => total + section.messages.length, 0);
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(1000);
  });
});

describe('the stylesheet hooks', () => {
  it('reads nothing a tenant holds: the same few statements with a theme as without', async () => {
    const bare = await world();
    const themed = await world();
    await publish(themed, theme({ tokens: { light: LIGHT }, stylesheet: '.page { color: red; }' }));
    const none = await statementsFor(bare, '/theme/stylesheet-hooks');
    const some = await statementsFor(themed, '/theme/stylesheet-hooks');
    expect(some).toBe(none);
    expect(some).toBeLessThanOrEqual(HOOKS_STATEMENTS);
  });

  it('costs the same to a caller holding only manage-clients', async () => {
    const w = await world();
    const both = await statementsFor(w, '/theme/stylesheet-hooks');
    const clientsOnly = await statementsFor(w, '/theme/stylesheet-hooks', ['manage-clients']);
    expect(clientsOnly).toBe(both);
  });

  it('refuses another tenant’s token before answering', async () => {
    const mine = await world();
    const theirs = await world();
    const res = await get(theirs, '/theme/stylesheet-hooks', await token(mine));
    expect(res.statusCode).toBe(401);
  });
});

async function clientPath(w: World): Promise<string> {
  const rows = await withTenant(appDb.db, w.tenantId, (tx) =>
    tx.select({ id: clients.id }).from(clients),
  );
  return `/clients/${rows[0]?.id ?? ''}/theme`;
}

describe('a client’s theme read', () => {
  it('says what the tenant supplies to a caller who may not read the tenant’s theme', async () => {
    const w = await world();
    await publish(w, theme({ tokens: { light: LIGHT }, stylesheet: '.page { color: red; }' }));
    const bearer = await token(w, ['manage-clients']);
    const view = (await get(w, await clientPath(w), bearer)).json<{
      tenant_sources: Record<string, string> | null;
    }>();
    expect(view.tenant_sources).toMatchObject({
      'tokens.light': 'tenant',
      stylesheet: 'tenant',
      'tokens.dark': 'default',
    });
    expect((await get(w, '/theme', bearer)).statusCode).toBe(403);
    const own = (await get(w, '/theme')).json<{ tenant_sources: unknown }>();
    expect(own.tenant_sources).toBeNull();
  });

  it('gives another tenant’s caller a 404 for the client, with nothing of the tenant’s layer', async () => {
    const mine = await world();
    const theirs = await world();
    await publish(theirs, theme({ tokens: { light: LIGHT }, stylesheet: '.page { color: red; }' }));
    const bearer = await token(mine, ['manage-clients']);
    const res = await get(mine, await clientPath(theirs), bearer);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('tenant_sources');
    expect(res.body).not.toContain('stylesheet');
  });

  it('costs the same few statements whatever the tenant sets', async () => {
    const bare = await world();
    const set = await world();
    await publish(set, theme({ tokens: { light: LIGHT, dark: NIGHT }, stylesheet: '.a { }' }));
    const none = await statementsFor(bare, await clientPath(bare), ['manage-clients']);
    const some = await statementsFor(set, await clientPath(set), ['manage-clients']);
    expect(some).toBe(none);
    expect(some).toBeLessThanOrEqual(CLIENT_THEME_STATEMENTS);
  });
});

describe('a client’s own read', () => {
  it('adds the one read of the tenant’s languages, whatever it offers', async () => {
    const one = await world();
    const many = await world('fr');
    const path = async (w: World): Promise<string> => (await clientPath(w)).replace('/theme', '');
    const few = await statementsFor(one, await path(one), ['manage-clients']);
    const more = await statementsFor(many, await path(many), ['manage-clients']);
    expect(more).toBe(few);
    expect(more).toBeLessThanOrEqual(CLIENT_READ_STATEMENTS);
  });
});

describe('what a preview says about itself', () => {
  it('costs the same few statements for a theme naming two images as for one', async () => {
    const bare = await world();
    const one = await world();
    const two = await world();
    const light = await putLogo(one, { width: 480, height: 96 });
    await publish(one, theme({ assets: { logo: { assetId: light.id, alt: 'Acme' } } }));
    const first = await putLogo(two, { width: 480, height: 96 });
    const second = await putLogo(two, { width: 100, height: 100 });
    await publish(
      two,
      theme({
        tokens: { light: LIGHT, dark: NIGHT },
        assets: {
          logo: { assetId: first.id, alt: 'Acme' },
          darkLogo: { assetId: second.id, alt: 'Acme dark' },
        },
      }),
    );
    const none = await statementsFor(bare, '/theme/preview/info');
    const single = await statementsFor(one, '/theme/preview/info');
    const double = await statementsFor(two, '/theme/preview/info');
    expect(double).toBe(single);
    expect(none).toBeLessThanOrEqual(single);
    expect(double).toBeLessThanOrEqual(INFO_STATEMENTS);
    expect(await statementsFor(two, '/theme/preview?kind=sign-in')).toBeGreaterThanOrEqual(double);
  });

  it('says where the page comes from for a published theme and for none', async () => {
    const bare = await world();
    const published = await world();
    await publish(published, theme({ tokens: { light: LIGHT } }));
    expect((await get(bare, '/theme/preview/info')).json()).toMatchObject({
      from: 'none',
      shown: 'default',
    });
    expect((await get(published, '/theme/preview/info')).json()).toMatchObject({
      from: 'published',
      shown: 'tenant',
    });
  });

  it('is refused another tenant’s token', async () => {
    const mine = await world();
    const theirs = await world();
    const res = await get(theirs, '/theme/preview/info', await token(mine));
    expect(res.statusCode).toBe(401);
  });
});

describe('an uploaded image’s content', () => {
  it('is the stored bytes of an image no published theme names', async () => {
    const w = await world();
    const logo = await putLogo(w, { width: 40, height: 20 });
    const res = await get(w, `/theme/assets/${logo.id}/content`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.equals(makePng({ width: 40, height: 20 }))).toBe(true);
    expect((await app.inject({ url: logo.url.replace(BASE, '') })).statusCode).toBe(404);
  });

  it('costs the same few statements for a large image among many as for a small one alone', async () => {
    const alone = await world();
    const crowded = await world();
    const small = await putLogo(alone, { width: 4, height: 4 });
    for (let n = 0; n < 5; n += 1) await putLogo(crowded, { width: 8 + n, height: 8 });
    const large = await putLogo(crowded, { width: 600, height: 400 });
    const few = await statementsFor(alone, `/theme/assets/${small.id}/content`);
    const many = await statementsFor(crowded, `/theme/assets/${large.id}/content`);
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(CONTENT_STATEMENTS);
  });

  it('is refused another tenant’s token, and finds no other tenant’s image', async () => {
    const mine = await world();
    const theirs = await world();
    const logo = await putLogo(theirs, { width: 6, height: 6 });
    const path = `/theme/assets/${logo.id}/content`;
    expect((await get(theirs, path, await token(mine))).statusCode).toBe(401);
    expect((await get(mine, path)).statusCode).toBe(404);
  });
});
