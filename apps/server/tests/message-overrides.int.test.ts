import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { MANAGE_TENANTS, SYSTEM_TENANT_NAME, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed, seedAdmin } from '#/cli/seed';
import { mintAdminToken } from '#/testing/plan-admin-drives';
import { isWork, StatementRecorder } from '#/testing/plan-capture';

// The admin API and the pages in one process: what an override changes is what
// the next page shows, with no wait for a cache to age.

interface Problem {
  errors: { path: string }[];
}

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
const recorder = new StatementRecorder();

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
    publicBaseUrl: 'https://id.example.test',
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
  const name = `words-${newId()}`;
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

function signIn(name: string, headers: Record<string, string> = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return app.inject({
    url: `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}`,
    headers,
  });
}

function admin(
  t: { name: string; token: string },
  method: 'GET' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url: `/admin/tenants/${t.name}${path}`,
    headers: {
      authorization: `Bearer ${t.token}`,
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

interface Tenant {
  id: string;
  name: string;
  token: string;
}

// The write the console makes: the version it read, or the expectation of none.
async function etagOf(t: Tenant, locale: string, key: string): Promise<string | undefined> {
  const items = (await admin(t, 'GET', `/message-overrides?locale=${locale}`)).json<{
    items: { key: string; etag: string }[];
  }>().items;
  return items.find((item) => item.key === key)?.etag;
}

async function setOverride(t: Tenant, locale: string, key: string, message: string) {
  const etag = await etagOf(t, locale, key);
  return admin(
    t,
    'PUT',
    `/message-overrides/${locale}/${key}`,
    { message },
    etag === undefined ? { 'if-none-match': '*' } : { 'if-match': etag },
  );
}

async function removeOverride(t: Tenant, locale: string, key: string) {
  return admin(t, 'DELETE', `/message-overrides/${locale}/${key}`, undefined, {
    'if-match': (await etagOf(t, locale, key)) ?? '"none"',
  });
}

// The token check, the tenant binding's lookups, the write with its lock,
// precondition read and bound check, the read-back and the audit row.
const PUT_STATEMENTS = 12;

describe('the statements a write costs', () => {
  const costOf = async (t: Tenant, key: string, message: string): Promise<number> => {
    const etag = await etagOf(t, 'en', key);
    const { result, statements } = await recorder.record(() =>
      admin(
        t,
        'PUT',
        `/message-overrides/en/${key}`,
        { message },
        etag === undefined ? { 'if-none-match': '*' } : { 'if-match': etag },
      ),
    );
    expect(result.statusCode, result.body).toBe(200);
    return statements.filter(isWork).length;
  };

  it('does not grow with the overrides the tenant already holds', async () => {
    const few = await tenant();
    const many = await tenant();
    await owner.sql`
      insert into message_overrides (tenant_id, locale, key, message)
      select ${many.id}::uuid, 'de', 'bulk.' || g, 'x' from generate_series(1, 400) g
    `;
    await setOverride(few, 'en', 'login.title', 'a');
    await setOverride(many, 'en', 'login.title', 'a');
    const created = [
      await costOf(few, 'login.submit', 'b'),
      await costOf(many, 'login.submit', 'b'),
    ];
    const changed = [await costOf(few, 'login.title', 'c'), await costOf(many, 'login.title', 'c')];
    expect(created[1]).toBe(created[0]);
    expect(changed[1]).toBe(changed[0]);
    expect(changed[0]).toBe(PUT_STATEMENTS);
  }, 60_000);
});

describe('a message override set through the admin API', () => {
  it('shows on the next page of this process, and goes when it is removed', async () => {
    const t = await tenant();
    expect((await signIn(t.name)).body).not.toContain('Welcome to the Acme door');

    const set = await setOverride(t, 'en', 'login.title', 'Welcome to the Acme door');
    expect(set.statusCode, set.body).toBe(200);
    expect((await signIn(t.name)).body).toContain('Welcome to the Acme door');

    await setOverride(t, 'en', 'login.title', 'Second wording');
    const second = (await signIn(t.name)).body;
    expect(second).toContain('Second wording');
    expect(second).not.toContain('Welcome to the Acme door');

    expect((await removeOverride(t, 'en', 'login.title')).statusCode).toBe(204);
    expect((await signIn(t.name)).body).not.toContain('Second wording');
  });

  it('is shown only in the language it was written for', async () => {
    const t = await tenant();
    expect(
      (await admin(t, 'PATCH', '/settings', { supported_locales: ['en', 'fr'] })).statusCode,
    ).toBe(200);
    await setOverride(t, 'fr', 'login.title', 'Entrez chez Acme');

    const fr = await signIn(t.name, { 'accept-language': 'fr' });
    expect(fr.body).toContain('Entrez chez Acme');
    expect(fr.headers['content-language']).toBe('fr');
    expect((await signIn(t.name, { 'accept-language': 'en' })).body).not.toContain(
      'Entrez chez Acme',
    );
  });

  it('shows markup as text', async () => {
    const t = await tenant();
    await setOverride(t, 'en', 'login.title', '<img src=x onerror=alert(1)> & co');
    const body = (await signIn(t.name)).body;
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co');
  });

  it('is checked as a message and against the catalogue before it is stored', async () => {
    const t = await tenant();
    const unbalanced = await setOverride(t, 'en', 'login.title', 'Welcome {name');
    expect(unbalanced.statusCode).toBe(400);
    expect(unbalanced.json<Problem>().errors[0]?.path).toBe('message');
    const plural = await setOverride(t, 'en', 'login.title', '{n, plural, one {a}}');
    expect(plural.statusCode).toBe(400);
    const unknown = await setOverride(t, 'en', 'login.nonesuch', 'x');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<Problem>().errors[0]?.path).toBe('key');
    const account = await setOverride(t, 'en', 'link.backToSignIn', 'Back');
    expect(account.statusCode, 'a key of another package’s catalogue is a page message').toBe(200);
    expect(
      (await admin(t, 'GET', '/message-overrides?locale=en')).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
  });

  it('may read only the arguments the page it replaces supplies', async () => {
    const t = await tenant();
    const extra = await setOverride(t, 'en', 'login.context', 'to reach {app} for {client}');
    expect(extra.statusCode).toBe(400);
    expect(extra.payload).toContain('{app}');
    expect(extra.payload).toContain('{client}');
    const none = await setOverride(t, 'en', 'login.title', 'Welcome, {name}');
    expect(none.statusCode).toBe(400);
    expect(none.payload).toContain('supplies no value');
    const fewer = await setOverride(t, 'en', 'login.context', 'to reach {client}');
    expect(fewer.statusCode, fewer.payload).toBe(200);
  });

  // A stored override that names an argument its page does not supply
  // exports, and the export is refused on import, naming key and argument,
  // until the file is corrected.
  it('refuses on import an override its own export carries that names an argument the page lacks', async () => {
    const t = await tenant();
    await owner.sql`
      insert into message_overrides (tenant_id, locale, key, message)
      values (${t.id}::uuid, 'en', 'login.context', 'to reach {app}')`;
    await seedAdmin({ username: `operator-${newId()}` });
    const [system] = await owner.sql<{ id: string }[]>`
      select id from tenants where name = ${SYSTEM_TENANT_NAME}`;
    const operator = await mintAdminToken(
      { http: app, app: appDb },
      { id: system?.id ?? '', name: SYSTEM_TENANT_NAME },
      [MANAGE_TENANTS, ...TENANT_CAPABILITIES],
    );
    const exported = await app.inject({
      url: `/admin/tenants/${t.name}/export`,
      headers: { authorization: `Bearer ${operator}` },
    });
    expect(exported.statusCode, exported.payload).toBe(200);
    const imported = await app.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${operator}`, 'content-type': 'application/json' },
      payload: { name: `words-${newId()}`, document: exported.json<object>() },
    });

    expect(imported.statusCode, imported.payload).toBe(400);
    const { errors } = imported.json<{ errors: { path: string; message: string }[] }>();
    const refused = errors.find((error) => error.path.endsWith('.message'));
    expect(refused?.path).toMatch(/^document\.message_overrides\[\d+\]\.message$/u);
    expect(refused?.message).toContain('{app}');
    expect(refused?.message).toContain('login.context');
    const put = await setOverride(t, 'en', 'login.context', 'to reach {app}');
    expect(put.statusCode).toBe(400);
    expect(put.payload).toContain('{app}');
  });

  it('is not shown to another tenant', async () => {
    const mine = await tenant();
    const theirs = await tenant();
    await setOverride(theirs, 'en', 'login.title', 'Private wording');
    expect((await signIn(mine.name)).body).not.toContain('Private wording');
    expect((await signIn(theirs.name)).body).toContain('Private wording');
  });
});
