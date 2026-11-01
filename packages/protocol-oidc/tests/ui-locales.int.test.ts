import { authenticationSessions, provisionTenant } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let tenantId: string;

const TENANT = 'acme';
const CLIENT_ID = 'ui-locales-client';
const REDIRECT_URI = 'https://app.example/callback';
// What the tenant lists; its own list is the only thing a request's
// preference is ever matched against.
const SHIPPED = ['en', 'fr'];

function authorize(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    ...query,
  });
  return http.inject({
    url: `/tenants/${TENANT}/protocol/openid-connect/auth?${params.toString()}`,
    headers,
  });
}

const documentLanguage = (res: LightMyRequestResponse): string | undefined =>
  /<html lang="([^"]*)" dir="([^"]*)">/u.exec(res.body)?.[1];

async function parkedRequests(): Promise<{ uiLocales?: string[] }[]> {
  const rows = await owner.db
    .select({ pendingRequest: authenticationSessions.pendingRequest })
    .from(authenticationSessions)
    .where(eq(authenticationSessions.tenantId, tenantId));
  return rows.map((row) => row.pendingRequest as { uiLocales?: string[] });
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify();
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 7),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();

  tenantId = newId();
  const clientId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: TENANT,
      supportedLocales: SHIPPED,
    });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'ui_locales client',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    await provisionClientDefaults(tx, clientId);
    await clientOidcConfigRepository(tx).create({
      clientId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[ODUDU-UI-LOCALES-01] ui_locales chooses the language of the sign-in', () => {
  it('parks ui_locales and shows it on the login page lang attribute', async () => {
    const res = await authorize({ ui_locales: 'de fr en' });
    expect(res.statusCode).toBe(200);
    expect(documentLanguage(res)).toBe('fr');
    expect(res.headers['content-language']).toBe('fr');
    expect((await parkedRequests()).some((p) => p.uiLocales?.join(' ') === 'de fr en')).toBe(true);
  });

  it('keeps the language on the page a rejected attempt re-renders', async () => {
    const first = await authorize({ ui_locales: 'fr' });
    const authSessionId = /name="auth_session_id" value="([^"]+)"/u.exec(first.body)?.[1];
    expect(authSessionId).toBeDefined();
    const again = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/login-actions/authenticate`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        auth_session_id: authSessionId ?? '',
        username: 'nobody',
        password: 'wrong',
      }).toString(),
    });
    expect(again.statusCode).toBe(200);
    expect(documentLanguage(again)).toBe('fr');
    expect(again.headers['content-language']).toBe('fr');
  });

  it('falls to Accept-Language, then to en', async () => {
    const browser = await authorize({}, { 'accept-language': 'de;q=0.9, fr-CA;q=0.8' });
    expect(documentLanguage(browser)).toBe('fr');
    expect(browser.headers['content-language']).toBe('fr');
    const none = await authorize();
    expect(documentLanguage(none)).toBe('en');
    expect(none.headers['content-language']).toBe('en');
  });

  it('prefers ui_locales to Accept-Language', async () => {
    const res = await authorize({ ui_locales: 'en' }, { 'accept-language': 'fr' });
    expect(documentLanguage(res)).toBe('en');
  });

  it('never reflects a tag the deployment does not ship', async () => {
    const hostile = '"><script>alert(1)</script> ../../etc/passwd zz-ZZ en%0d%0aX:y';
    const res = await authorize({ ui_locales: hostile });
    expect(res.statusCode).toBe(200);
    expect(documentLanguage(res)).toBe('en');
    expect(res.headers['content-language']).toBe('en');
    expect(res.body).not.toContain('alert(1)');
  });

  it('parks at most the bounded list, each tag at most 35 characters', async () => {
    const long = 'x'.repeat(36);
    const many = Array.from({ length: 100 }, (_, i) => `a${String(i)}`).join(' ');
    const res = await authorize({ ui_locales: `${long} ${many}` });
    expect(res.statusCode).toBe(200);
    const parked = (await parkedRequests()).flatMap((p) => p.uiLocales ?? []);
    expect(parked).not.toContain(long);
    expect((await parkedRequests()).every((p) => (p.uiLocales ?? []).length <= 16)).toBe(true);
  });
});

describe('[ODUDU-UI-LOCALES-03] a page with no parked request follows Accept-Language', () => {
  it('shows the authorize error page in the browser language', async () => {
    const res = await authorize({ client_id: 'no-such-client' }, { 'accept-language': 'fr-CA' });
    expect(res.statusCode).toBe(400);
    expect(documentLanguage(res)).toBe('fr');
    expect(res.headers['content-language']).toBe('fr');
  });

  it('shows the signed-out page in the browser language', async () => {
    const res = await http.inject({
      url: `/tenants/${TENANT}/protocol/openid-connect/logout`,
      headers: { 'accept-language': 'de;q=0.9, fr;q=0.8' },
    });
    expect(documentLanguage(res)).toBe('fr');
    expect(res.headers['content-language']).toBe('fr');
  });

  it('survives a hostile header', async () => {
    const res = await authorize(
      { client_id: 'no-such-client' },
      { 'accept-language': `${'x,'.repeat(3000)};;q=zz,*` },
    );
    expect(res.statusCode).toBe(400);
    expect(documentLanguage(res)).toBe('en');
  });
});

describe('[ODUDU-UI-LOCALES-02] discovery advertises the shipped locales', () => {
  it('lists ui_locales_supported and omits claims_locales_supported', async () => {
    const res = await http.inject({ url: `/tenants/${TENANT}/.well-known/openid-configuration` });
    const doc = res.json<Record<string, unknown>>();
    expect(doc.ui_locales_supported).toEqual(SHIPPED);
    expect(doc).not.toHaveProperty('claims_locales_supported');
  });
});

const documentTheme = (res: LightMyRequestResponse): string | undefined =>
  /<html [^>]*data-theme="([^"]*)"/u.exec(res.body)?.[1];

describe("the person's light or dark choice reaches the pages", () => {
  const pages: [string, () => Promise<LightMyRequestResponse>, string][] = [
    ['the sign-in form', () => authorize({}, { cookie: 'odudu-theme=dark' }), 'dark'],
    [
      'the authorize error page',
      () => authorize({ client_id: 'no-such-client' }, { cookie: 'a=1; odudu-theme=light' }),
      'light',
    ],
    [
      'the signed-out page',
      () =>
        http.inject({
          url: `/tenants/${TENANT}/protocol/openid-connect/logout`,
          headers: { cookie: 'odudu-theme=dark' },
        }),
      'dark',
    ],
  ];

  it.each(pages)("names the cookie's theme on %s", async (_name, request, theme) => {
    const res = await request();
    expect(documentTheme(res)).toBe(theme);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("names the cookie's theme on the expired sign-in page and the rejected-attempt page", async () => {
    const post = (authSessionId: string, password: string): Promise<LightMyRequestResponse> =>
      http.inject({
        method: 'POST',
        url: `/tenants/${TENANT}/login-actions/authenticate`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: 'odudu-theme=light',
        },
        payload: new URLSearchParams({
          auth_session_id: authSessionId,
          username: 'nobody',
          password,
        }).toString(),
      });
    const expired = await post(newId(), 'wrong');
    expect(expired.statusCode).toBe(400);
    expect(documentTheme(expired)).toBe('light');

    const first = await authorize();
    const authSessionId = /name="auth_session_id" value="([^"]+)"/u.exec(first.body)?.[1];
    const rejected = await post(authSessionId ?? '', 'wrong');
    expect(rejected.statusCode).toBe(200);
    expect(documentTheme(rejected)).toBe('light');
  });

  it('names none without the cookie, and keeps the page the same bytes as before', async () => {
    const res = await authorize();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('data-theme');
    expect(res.body).toContain('<html lang="en" dir="ltr">');
  });

  it.each([
    ['uppercase', 'odudu-theme=LIGHT'],
    ['a break-out', 'odudu-theme=x"><script>alert(1)</script>'],
    ['a suffix', 'odudu-theme=light evil'],
    ['system', 'odudu-theme=system'],
    ['a very long value', `odudu-theme=${'x'.repeat(9000)}`],
    ['a long header holding a good cookie', `odudu-theme=dark; pad=${'x'.repeat(9000)}`],
    ['two of them', 'odudu-theme=light; odudu-theme=dark'],
  ])('ignores %s and reflects nothing of it', async (_name, cookie) => {
    const res = await authorize({}, { cookie });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('data-theme');
    expect(res.body).not.toContain('alert(1)');
  });
});
