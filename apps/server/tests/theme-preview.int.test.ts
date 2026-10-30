import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { assetRepository } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, makePng, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin, seed } from '#/cli/seed';
import { CONSOLE_CLIENT_KEY } from '#/testing/console-key';
import {
  type ConsoleStack,
  Jar,
  KEK,
  seedTenantAdmin,
  signInToTenant,
  startConsoleApp,
} from '#/testing/console-harness';
import { mintAdminToken } from '#/testing/plan-admin-drives';

// The real composition root with the console in front: the draft preview is
// the page the production renderers give, reached the way the console's frame
// reaches it, with the admin's session cookie and no bearer token.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let stack: ConsoleStack;

const BASE = 'http://console.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_CONSOLE_CLIENT_KEY = CONSOLE_CLIENT_KEY;
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  await seedAdmin({ username: `setup-${newId()}` });
  stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
}, 180_000);

afterAll(async () => {
  await stack.app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_CONSOLE_CLIENT_KEY;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appDb.close();
  await owner.close();
  await container.stop();
});

const MARKED = (marker: string): string =>
  `<div class="${marker}"><h1>{{t "login.title"}}</h1>{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>`;

interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly token: string;
}

async function tenant(): Promise<Tenant> {
  const name = `preview-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT_URI],
    username: 'user',
    password: 'correct horse battery staple',
  });
  await owner.db
    .update(tenants)
    .set({ rememberMeAllowed: true })
    .where(eq(tenants.id, seeded.tenantId));
  const token = await mintAdminToken(
    { http: stack.app, app: appDb },
    { id: seeded.tenantId, name },
    ['manage-tenant'],
  );
  return { id: seeded.tenantId, name, token };
}

function admin(
  t: Tenant,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return stack.app.inject({
    method,
    url: `/admin/tenants/${t.name}${path}`,
    headers: {
      authorization: `Bearer ${t.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

function signInPage(name: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return stack.app.inject({
    url: `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

// The element a theme's own template produced, with the one value that is
// minted per request taken out.
function themed(body: string, marker: string): string {
  const start = body.indexOf(`<div class="${marker}">`);
  const end = body.indexOf('</form>', start);
  expect(start, body.slice(0, 400)).toBeGreaterThan(-1);
  return body
    .slice(start, end)
    .replace(/name="auth_session_id" value="[^"]*"/u, 'name="auth_session_id"');
}

describe('the preview of a draft theme', () => {
  it('is the page the production renderer gives for the same theme', async () => {
    const t = await tenant();
    const saved = await admin(t, 'PUT', '/theme', { templates: { 'sign-in': MARKED('exact') } });
    expect(saved.statusCode, saved.body).toBe(200);
    const preview = await admin(t, 'GET', '/theme/preview?kind=sign-in');
    expect((await admin(t, 'POST', '/theme/publish')).statusCode).toBe(200);
    const production = await signInPage(t.name);

    expect(themed(preview.body, 'exact')).toBe(themed(production.body, 'exact'));
  });

  it('carries a draft image that no public address serves, and the address stays unserved', async () => {
    const t = await tenant();
    const png = makePng({ width: 10, height: 6 });
    const up = await stack.app.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/theme/assets?kind=logo`,
      headers: { authorization: `Bearer ${t.token}`, 'content-type': 'image/png' },
      payload: png,
    });
    const image = up.json<{ id: string; sha256: string }>();
    await admin(t, 'PUT', '/theme', { assets: { logo: { assetId: image.id, alt: 'Logo' } } });

    const preview = await admin(t, 'GET', '/theme/preview');
    expect(preview.body).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/u);
    expect(preview.body).not.toContain(image.sha256);
    const address = `/tenants/${t.name}/brand/${image.sha256}.png`;
    expect((await stack.app.inject({ url: address })).statusCode).toBe(404);
    expect((await signInPage(t.name)).body).not.toContain(address);
  });

  it('leaves every ordinary page unframable, a themed one included', async () => {
    const t = await tenant();
    await admin(t, 'PUT', '/theme', { stylesheet: '.page { color: red; }' });
    await admin(t, 'POST', '/theme/publish');

    for (const page of [await signInPage(t.name), await admin(t, 'GET', '/theme/preview')]) {
      expect(page.statusCode).toBe(200);
    }
    const production = await signInPage(t.name);
    expect(production.headers['x-frame-options']).toBe('DENY');
    expect(String(production.headers['content-security-policy'])).toContain(
      "frame-ancestors 'none'",
    );
  });
});

describe('the preview through the console', () => {
  const PATH = (name: string, query = '') =>
    `/console/api/admin/tenants/${name}/theme/preview${query}`;

  async function signedIn(): Promise<{ jar: Jar; tenant: string }> {
    const { tenant: name, username } = await seedTenantAdmin();
    const jar = new Jar();
    await signInToTenant(stack, jar, name, username);
    return { jar, tenant: name };
  }

  const get = (jar: Jar, url: string): Promise<LightMyRequestResponse> =>
    stack.app.inject({ url, headers: { host: stack.base.host, ...jar.header() } });

  it('answers a frame with only the admin’s session cookie, under its own policy', async () => {
    const { jar, tenant: name } = await signedIn();
    const res = await get(jar, PATH(name, '?kind=consent'));
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.body).toContain('<main class="page">');
    expect(String(res.headers['content-security-policy']).split('; ')).toContain(
      "frame-ancestors 'self'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('answers an uploaded image’s bytes unchanged, with its type and no caching', async () => {
    const { jar, tenant: name } = await signedIn();
    const [row] = await owner.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.name, name));
    const tenantId = row?.id ?? '';
    const bytes = makePng({ width: 12, height: 7 });
    const stored = await withTenant(appDb.db, tenantId, (tx) =>
      assetRepository(tx).put({
        tenantId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mime: 'image/png',
        width: 12,
        height: 7,
        bytes,
        tenantCapBytes: 1024 * 1024,
      }),
    );
    if (stored === 'over_cap') throw new Error('over cap');

    const res = await get(
      jar,
      `/console/api/admin/tenants/${name}/theme/assets/${stored.id}/content`,
    );

    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.rawPayload.equals(bytes)).toBe(true);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const anonymous = await get(
      new Jar(),
      `/console/api/admin/tenants/${name}/theme/assets/${stored.id}/content`,
    );
    expect(anonymous.statusCode).toBe(401);
  });

  it('is refused without an admin session', async () => {
    const { tenant: name } = await signedIn();
    const res = await get(new Jar(), PATH(name));
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('<main');
  });

  it('is refused for a tenant the admin does not administer', async () => {
    const { jar } = await signedIn();
    const other = await tenant();
    const res = await get(jar, PATH(other.name));
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('<main');
  });
});
