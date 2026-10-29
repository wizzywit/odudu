import { createHash } from 'node:crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import {
  assetRepository,
  brandingCss,
  themeRepository,
  themeVersions,
  tokensCss,
  type ThemeBody,
} from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';

// The real composition root and a real PostgreSQL: what a themed page links
// is served, as public immutable files, and nothing else is.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
const queries: string[] = [];

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const SIGN_IN = (logo: string): string =>
  `<div class="themed">${logo === '' ? '' : `<img src="${logo}" alt="Logo">`}{{intro}}{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>`;

// The headers that name the request or the moment, which differ by design.
function stable(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name !== 'date' && name !== 'x-request-id'),
  );
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, {
    max: 8,
    onQueryForTests: (query) => {
      queries.push(query);
    },
  });
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
  clientRow: (clientId: string) => Promise<string>;
}

async function world(clientIds: string[]): Promise<World> {
  const name = `brand-${newId()}`;
  let tenantId = '';
  for (const clientId of clientIds) {
    const seeded = await seed({ tenant: name, clientId, redirectUris: [REDIRECT_URI] });
    tenantId = seeded.tenantId;
  }
  return {
    name,
    tenantId,
    clientRow: async (clientId) => {
      const [row] = await owner.db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, clientId)));
      if (row === undefined) throw new Error('no such client');
      return row.id;
    },
  };
}

async function storeImage(
  tenantId: string,
  bytes: Buffer,
): Promise<{ id: string; sha256: string }> {
  const stored = await withTenant(appDb.db, tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId,
      sha256: sha256(bytes),
      mime: 'image/png',
      width: 1,
      height: 1,
      bytes,
      tenantCapBytes: 1024 * 1024,
    }),
  );
  if (stored === 'over_cap') throw new Error('refused');
  return stored;
}

async function save(
  tenantId: string,
  clientId: string | null,
  body: ThemeBody,
  options: { publish: boolean } = { publish: true },
): Promise<void> {
  await withTenant(appDb.db, tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId, clientId };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    if (options.publish) await themes.publish(scope);
  });
}

function themed(parts: Partial<ThemeBody>): ThemeBody {
  return {
    tokens: { font: 'IBM Plex Mono' },
    stylesheet: null,
    templates: {},
    assets: {},
    ...parts,
  };
}

async function authorize(tenant: string, clientId: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return app.inject({ url: `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}` });
}

// A tenant whose published theme names one image and a stylesheet.
async function brandedTenant(
  bytes: Buffer = PNG,
): Promise<{ w: World; image: string; imagePath: string }> {
  const w = await world(['portal']);
  const image = await storeImage(w.tenantId, bytes);
  const imagePath = `/tenants/${w.name}/brand/${image.sha256}.png`;
  await save(
    w.tenantId,
    null,
    themed({
      stylesheet: '.logo{display:none}',
      templates: { 'sign-in': SIGN_IN(imagePath) },
      assets: { logo: { assetId: image.id, alt: 'Logo' }, favicon: { assetId: image.id } },
    }),
  );
  return { w, image: image.sha256, imagePath };
}

describe('a published image', () => {
  it('is served with immutable caching, nosniff, its stored type and no cookie', async () => {
    const { imagePath, image } = await brandedTenant();
    const res = await app.inject({ url: imagePath });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers.etag).toBe(`"${image}"`);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers HEAD with the headers and no body', async () => {
    const { imagePath } = await brandedTenant();
    const res = await app.inject({ method: 'HEAD', url: imagePath });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.rawPayload).toHaveLength(0);
  });

  it('answers 304 to a matching If-None-Match, weak or in a list', async () => {
    const { imagePath, image } = await brandedTenant();
    for (const header of [`"${image}"`, `W/"${image}"`, `"other", "${image}"`]) {
      const res = await app.inject({ url: imagePath, headers: { 'if-none-match': header } });
      expect(res.statusCode).toBe(304);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.rawPayload).toHaveLength(0);
    }
    const stale = await app.inject({ url: imagePath, headers: { 'if-none-match': '"other"' } });
    expect(stale.statusCode).toBe(200);
  });

  it('is served when only a published client theme names it', async () => {
    const w = await world(['portal']);
    const image = await storeImage(w.tenantId, Buffer.concat([PNG, Buffer.from('client')]));
    await save(
      w.tenantId,
      await w.clientRow('portal'),
      themed({ assets: { logo: { assetId: image.id, alt: 'Logo' } } }),
    );
    const res = await app.inject({ url: `/tenants/${w.name}/brand/${image.sha256}.png` });
    expect(res.statusCode).toBe(200);
  });

  it('is a 404 when only a draft names it', async () => {
    const w = await world(['portal']);
    const image = await storeImage(w.tenantId, Buffer.concat([PNG, Buffer.from('draft')]));
    await save(w.tenantId, null, themed({ assets: { logo: { assetId: image.id, alt: 'Logo' } } }), {
      publish: false,
    });
    const res = await app.inject({ url: `/tenants/${w.name}/brand/${image.sha256}.png` });
    expect(res.statusCode).toBe(404);
  });

  it('is a 404 once a later publish drops it, and once it is deleted', async () => {
    const { w, imagePath } = await brandedTenant();
    expect((await app.inject({ url: imagePath })).statusCode).toBe(200);
    await save(w.tenantId, null, themed({}));
    expect((await app.inject({ url: imagePath })).statusCode).toBe(404);

    const deleted = await brandedTenant();
    await owner.sql`delete from theme_version_assets where tenant_id = ${deleted.w.tenantId}`;
    await owner.sql`delete from theme_assets where tenant_id = ${deleted.w.tenantId}`;
    expect((await app.inject({ url: deleted.imagePath })).statusCode).toBe(404);
  });

  it("is a 404 under another tenant's name, identical to a hash nobody holds", async () => {
    const a = await brandedTenant();
    const b = await brandedTenant(Buffer.concat([PNG, Buffer.from('b')]));
    const foreign = await app.inject({ url: `/tenants/${b.w.name}/brand/${a.image}.png` });
    const missing = await app.inject({ url: `/tenants/${b.w.name}/brand/${'0'.repeat(64)}.png` });
    const unknownTenant = await app.inject({
      url: `/tenants/no-such-${newId()}/brand/${a.image}.png`,
    });
    for (const res of [foreign, unknownTenant]) {
      expect(res.statusCode).toBe(404);
      expect(res.rawPayload.toString()).toBe(missing.rawPayload.toString());
      expect(stable(res.headers)).toEqual(stable(missing.headers));
    }
    const probe = await app.inject({
      url: `/tenants/${b.w.name}/brand/${a.image}.png`,
      headers: { 'if-none-match': `"${a.image}"` },
    });
    expect(probe.statusCode).toBe(404);
  });

  it('is a 404 under an extension that is not its stored type', async () => {
    const { w, image } = await brandedTenant();
    for (const extension of ['jpg', 'webp', 'css', 'svg', 'png.css']) {
      const res = await app.inject({ url: `/tenants/${w.name}/brand/${image}.${extension}` });
      expect(res.statusCode, extension).toBe(404);
    }
  });

  it('is a 404 for a name that is not a lowercase sha256 and a type', async () => {
    const { w, image } = await brandedTenant();
    const odd = [
      `${image.toUpperCase()}.png`,
      `${image.slice(2)}.png`,
      `${image}0.png`,
      image,
      `${image}.`,
      '%00.png',
      '..%2f..%2fetc%2fpasswd',
    ];
    for (const file of odd) {
      const res = await app.inject({ url: `/tenants/${w.name}/brand/${file}` });
      expect(res.statusCode, file).toBe(404);
    }
  });

  it('answers every malformed shape with the same bare 404, a long segment included', async () => {
    const { w, image } = await brandedTenant();
    const missing = await app.inject({ url: `/tenants/${w.name}/brand/${'0'.repeat(64)}.png` });
    const shapes = [
      `/tenants/${w.name}/brand/${image.toUpperCase()}.png`,
      `/tenants/${w.name}/brand/${image}.svg`,
      `/tenants/${w.name}/brand/${'a'.repeat(150)}.png`,
      `/tenants/${w.name}/brand/${'a'.repeat(5000)}.png`,
      `/tenants/${w.name}/brand/c/${'a'.repeat(150)}/${image}.css`,
      `/tenants/${w.name}/brand/c/${'a'.repeat(5000)}/${image}.css`,
      `/tenants/${'t'.repeat(150)}/brand/${image}.png`,
      `/tenants/${'t'.repeat(5000)}/brand/${image}.png`,
    ];
    for (const url of shapes) {
      const res = await app.inject({ url });
      expect(res.statusCode, url.slice(0, 80)).toBe(404);
      expect(res.rawPayload.toString(), url.slice(0, 80)).toBe(missing.rawPayload.toString());
      expect(stable(res.headers), url.slice(0, 80)).toEqual(stable(missing.headers));
    }
  });

  it('leaves the router answer for a long segment elsewhere under /tenants as it was', async () => {
    const res = await app.inject({ url: `/tenants/${'t'.repeat(150)}/login-actions/registration` });
    expect(res.statusCode).toBe(414);
  });

  it('decides a conditional request without reading the bytes', async () => {
    const { imagePath, image } = await brandedTenant();
    queries.length = 0;
    const res = await app.inject({ url: imagePath, headers: { 'if-none-match': `"${image}"` } });
    expect(res.statusCode).toBe(304);
    const reads = queries.filter((q) => q.includes('theme_assets'));
    expect(reads).toHaveLength(1);
    expect(reads[0]).not.toContain('"bytes"');
    queries.length = 0;
    expect((await app.inject({ url: imagePath })).statusCode).toBe(200);
    expect(queries.filter((q) => q.includes('"bytes"'))).toHaveLength(1);
  });

  it('is served to concurrent requests, each the same bytes', async () => {
    const { imagePath } = await brandedTenant();
    const all = await Promise.all(Array.from({ length: 24 }, () => app.inject({ url: imagePath })));
    for (const res of all) {
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(PNG)).toBe(true);
    }
  });
});

describe('what a themed page links', () => {
  it('resolves, from the rendered sign-in, to files with exactly the hash in their URL', async () => {
    const { w } = await brandedTenant();
    const page = await authorize(w.name, 'portal');
    expect(page.statusCode).toBe(200);
    const sheet = /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(page.body)?.[1];
    const icon = /<link rel="icon" href="(\/tenants\/[^"]+)">/u.exec(page.body)?.[1];
    const logo = /<img src="(\/tenants\/[^"]+)" alt="Logo">/u.exec(page.body)?.[1];
    expect(sheet).toBeDefined();
    expect(icon).toBeDefined();
    expect(logo).toBeDefined();

    for (const url of [sheet, icon, logo].filter((u): u is string => u !== undefined)) {
      const res = await app.inject({ url });
      const hash = /\/([0-9a-f]{64})\.[a-z]+$/u.exec(url)?.[1];
      expect(res.statusCode, url).toBe(200);
      expect(sha256(res.rawPayload), url).toBe(hash);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    const css = await app.inject({ url: sheet ?? '' });
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toContain('--font-sans');
    expect(css.body).toContain('.logo{display:none}');
    expect((await app.inject({ url: logo ?? '' })).headers['content-type']).toBe('image/png');
  });

  it('draws a published background in the stylesheet it links, and licenses the image', async () => {
    const w = await world(['portal']);
    const image = await storeImage(w.tenantId, PNG);
    await save(w.tenantId, null, themed({ assets: { background: { assetId: image.id } } }));
    const page = await authorize(w.name, 'portal');
    const sheet = /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(page.body)?.[1];
    expect(sheet).toBeDefined();
    const url = `/tenants/${w.name}/brand/${image.sha256}.png`;
    const css = await app.inject({ url: sheet ?? '' });
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toContain(`body{background-image:url('${url}');`);
    const policy = String(page.headers['content-security-policy']);
    const imgSrc = policy.split('; ').find((part) => part.startsWith('img-src ')) ?? '';
    expect(imgSrc.split(' ').some((source) => source.endsWith(url))).toBe(true);
    expect((await app.inject({ url })).statusCode).toBe(200);
  });

  it('adds no background rule for a tenant whose theme sets none', async () => {
    const { w } = await brandedTenant();
    const page = await authorize(w.name, 'portal');
    const sheet = /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(page.body)?.[1];
    expect((await app.inject({ url: sheet ?? '' })).body).not.toContain('background');
  });

  it('serves a client-over-tenant stylesheet under the client that makes it, to a second replica', async () => {
    const { w } = await brandedTenant();
    await save(
      w.tenantId,
      await w.clientRow('portal'),
      themed({ stylesheet: '.brand{opacity:1}' }),
    );
    const page = await authorize(w.name, 'portal');
    const sheet =
      /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(page.body)?.[1] ?? '';
    expect(sheet).toContain(`/brand/c/${await w.clientRow('portal')}/`);

    // Nothing in this process is needed: a new app, with no cache and no
    // memory of the page, answers for the same URL.
    const replica = buildApp({
      database: appDb,
      ownerDatabase: owner,
      kek: KEK,
      logger: pino({ level: 'silent' }),
      tls: false,
      publicBaseUrl: BASE,
    });
    await replica.ready();
    try {
      const res = await replica.inject({ url: sheet });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('.brand{opacity:1}');
      expect(sha256(res.rawPayload)).toBe(/([0-9a-f]{64})\.css$/u.exec(sheet)?.[1]);
      const hash = /([0-9a-f]{64})\.css$/u.exec(sheet)?.[1] ?? '';
      const tenantForm = await replica.inject({ url: `/tenants/${w.name}/brand/${hash}.css` });
      expect(tenantForm.statusCode).toBe(404);
    } finally {
      await replica.close();
    }
  });

  it('answers 404 for the previous stylesheet hash once a new version is published', async () => {
    const { w } = await brandedTenant();
    const before =
      /href="(\/tenants\/[^"]+\.css)"/u.exec((await authorize(w.name, 'portal')).body)?.[1] ?? '';
    expect((await app.inject({ url: before })).statusCode).toBe(200);
    await save(w.tenantId, null, themed({ stylesheet: '.logo{display:block}' }));
    expect((await app.inject({ url: before })).statusCode).toBe(404);
  });

  it('never serves a hostile stylesheet, even one written past the save checks', async () => {
    const { w } = await brandedTenant();
    const hostile = '@import url(https://evil.example/x.css);.logo{display:none}';
    await owner.db
      .update(themeVersions)
      .set({ body: themed({ stylesheet: hostile }) })
      .where(and(eq(themeVersions.tenantId, w.tenantId), eq(themeVersions.state, 'published')));
    // The hash an unchecked build of that row would have: tokens, then the rules.
    const asked = sha256(brandingCss(tokensCss({ font: 'IBM Plex Mono' }), hostile));
    const res = await app.inject({ url: `/tenants/${w.name}/brand/${asked}.css` });
    expect(res.statusCode).toBe(404);
  });

  it('answers 404 for a stylesheet of a tenant with no published theme', async () => {
    const w = await world(['portal']);
    const res = await app.inject({ url: `/tenants/${w.name}/brand/${'0'.repeat(64)}.css` });
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses a client segment that is not a row id', async () => {
    const { w } = await brandedTenant();
    for (const client of ['portal', 'x', '..']) {
      const res = await app.inject({
        url: `/tenants/${w.name}/brand/c/${client}/${'0'.repeat(64)}.css`,
      });
      expect(res.statusCode, client).toBe(404);
    }
  });

  it('is no alias of the tenant-form URL under a client with no layer', async () => {
    const { w } = await brandedTenant();
    const page = await authorize(w.name, 'portal');
    const sheet = /href="(\/tenants\/[^"]+\.css)"/u.exec(page.body)?.[1] ?? '';
    expect(sheet).not.toContain('/c/');
    const hash = /([0-9a-f]{64})\.css$/u.exec(sheet)?.[1] ?? '';
    expect((await app.inject({ url: sheet })).statusCode).toBe(200);
    const themelessClient = await w.clientRow('portal');
    const foreign = await brandedTenant(Buffer.concat([PNG, Buffer.from('other')]));
    const foreignClient = await foreign.w.clientRow('portal');
    for (const client of [themelessClient, foreignClient, newId()]) {
      const res = await app.inject({ url: `/tenants/${w.name}/brand/c/${client}/${hash}.css` });
      expect(res.statusCode, client).toBe(404);
    }
  });

  it('answers random hashes from one small read each, building once at most', async () => {
    const { w } = await brandedTenant();
    const bodies = () => queries.filter((q) => q.includes('"body"')).length;
    queries.length = 0;
    for (let n = 0; n < 60; n += 1) {
      const hash = n.toString(16).padStart(64, '0');
      expect((await app.inject({ url: `/tenants/${w.name}/brand/${hash}.css` })).statusCode).toBe(
        404,
      );
    }
    expect(bodies()).toBeLessThanOrEqual(1);
    const identities = queries.filter(
      (q) => q.includes('"theme_versions"') && !q.includes('"body"'),
    );
    expect(identities.length).toBeGreaterThanOrEqual(60);
  });
});
