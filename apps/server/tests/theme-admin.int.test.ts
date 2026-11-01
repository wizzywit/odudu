import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { mintAdminToken } from '#/testing/plan-admin-drives';

// The admin API and the pages in one process: what a publish, a restore or a
// reset changes is what the next page shows, with no wait for a cache to age.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const SIGN_IN = (marker: string): string =>
  `<div class="${marker}"><h1>{{t "login.title"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>`;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
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

async function tenant(): Promise<{ id: string; name: string; token: string }> {
  const name = `admin-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT_URI],
    username: 'user',
    password: 'correct horse battery staple',
  });
  const token = await mintAdminToken({ http: app, app: appDb }, { id: seeded.tenantId, name }, [
    'manage-tenant',
  ]);
  return { id: seeded.tenantId, name, token };
}

function signIn(name: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return app.inject({ url: `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}` });
}

function admin(
  t: { name: string; token: string },
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  ifMatch?: string,
) {
  return app.inject({
    method,
    url: `/admin/tenants/${t.name}${path}`,
    headers: {
      authorization: `Bearer ${t.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

describe('a theme changed through the admin API', () => {
  it('shows on the next page of this process, through publish, restore and reset', async () => {
    const t = await tenant();
    // Warms the cache with "no theme", the entry a publish has to replace.
    expect((await signIn(t.name)).body).not.toContain('themed-one');

    const saved = await admin(t, 'PUT', '/theme', {
      templates: { 'sign-in': SIGN_IN('themed-one') },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await signIn(t.name)).body, 'a draft is never shown').not.toContain('themed-one');
    expect((await admin(t, 'POST', '/theme/publish')).statusCode).toBe(200);
    expect((await signIn(t.name)).body).toContain('themed-one');

    const second = await admin(t, 'PUT', '/theme', {
      templates: { 'sign-in': SIGN_IN('themed-two') },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect((await admin(t, 'POST', '/theme/publish')).statusCode).toBe(200);
    const page = await signIn(t.name);
    expect(page.body).toContain('themed-two');
    expect(page.body).not.toContain('themed-one');

    const versions = (await admin(t, 'GET', '/theme/versions')).json<{
      items: { id: string; version: number }[];
    }>().items;
    const first = versions.find((v) => v.version === 1);
    expect((await admin(t, 'POST', `/theme/versions/${first?.id ?? ''}/restore`)).statusCode).toBe(
      200,
    );
    expect((await signIn(t.name)).body).toContain('themed-one');

    expect((await admin(t, 'DELETE', '/theme')).statusCode).toBe(200);
    expect((await signIn(t.name)).body).not.toContain('themed-one');
  });

  it('refuses a template whose message key the page’s catalogue lacks, and shows nothing of it', async () => {
    const t = await tenant();
    const res = await admin(t, 'PUT', '/theme', {
      templates: { 'sign-in': `<p>{{t "no.such.key"}}</p>${SIGN_IN('themed-broken')}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe('unknown-message-key');
    expect((await signIn(t.name)).body).not.toContain('themed-broken');
  });

  it('judges a key by the catalogue of the package that fills the page kind', async () => {
    const t = await tenant();
    // A recovery-codes page is the authn-flows package's, whose catalogue
    // lacks the sign-in page's title.
    const res = await admin(t, 'PUT', '/theme', {
      templates: { 'recovery-codes': '<p>{{t "login.title"}}</p>' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { code: string }[] }>().errors.map((e) => e.code)).toContain(
      'unknown-message-key',
    );
  });
});
