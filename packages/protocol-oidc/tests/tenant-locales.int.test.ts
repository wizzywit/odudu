import { provisionTenant } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { clients, messageOverrideRepository, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId, type OverridesResolver } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'locales-client';
const REDIRECT_URI = 'https://app.example/callback';

interface Seeded {
  name: string;
  id: string;
}

async function seedTenant(
  label: string,
  settings: { supportedLocales: string[]; defaultLocale: string | null },
): Promise<Seeded> {
  const id = newId();
  const name = `${label}-${id.slice(-8)}`;
  const clientRowId = newId();
  await withTenant(app.db, id, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id, name, ...settings });
    await provisionTenant(tx, id);
    await tx.insert(clients).values({
      id: clientRowId,
      tenantId: id,
      clientId: CLIENT_ID,
      name: 'Locales client',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    await provisionClientDefaults(tx, clientRowId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientRowId,
      tenantId: id,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
  return { name, id };
}

async function override(tenant: Seeded, locale: string, key: string, message: string) {
  await owner.sql`
    insert into message_overrides (tenant_id, locale, key, message)
    values (${tenant.id}, ${locale}, ${key}, ${message})
  `;
}

const resolveOverrides: OverridesResolver = (tenantId, locale) =>
  withTenant(app.db, tenantId, (tx) =>
    messageOverrideRepository(tx, { isKnownKey: () => true }).forRender(tenantId, locale),
  );

function authorize(
  tenant: Seeded,
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
    url: `/tenants/${tenant.name}/protocol/openid-connect/auth?${params.toString()}`,
    headers,
  });
}

const language = (res: LightMyRequestResponse): string | undefined =>
  /<html lang="([^"]*)"/u.exec(res.body)?.[1];

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 5),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      resolveOverrides,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

describe('a tenant’s own list of languages', () => {
  it('is what discovery advertises as ui_locales_supported', async () => {
    const tenant = await seedTenant('list', {
      supportedLocales: ['en', 'fr-CA', 'ar'],
      defaultLocale: null,
    });
    const res = await http.inject({
      url: `/tenants/${tenant.name}/.well-known/openid-configuration`,
    });
    expect(res.json<{ ui_locales_supported: string[] }>().ui_locales_supported).toEqual([
      'en',
      'fr-CA',
      'ar',
    ]);
  });

  it('is all a request is matched against, whatever the browser or ui_locales asks for', async () => {
    const englishOnly = await seedTenant('en-only', {
      supportedLocales: ['en'],
      defaultLocale: null,
    });
    const res = await authorize(englishOnly, { ui_locales: 'fr' }, { 'accept-language': 'fr' });
    expect(language(res)).toBe('en');
  });

  it('matches a regional tag by the list’s own spelling', async () => {
    const tenant = await seedTenant('region', {
      supportedLocales: ['en', 'fr-CA'],
      defaultLocale: null,
    });
    const res = await authorize(tenant, {}, { 'accept-language': 'fr-ca' });
    expect(language(res)).toBe('fr-CA');
    expect(res.headers['content-language']).toBe('fr-CA');
  });
});

describe('a tenant’s default language', () => {
  it('is used before the browser’s preference and after ui_locales', async () => {
    const tenant = await seedTenant('default', {
      supportedLocales: ['en', 'fr', 'ar'],
      defaultLocale: 'fr',
    });
    expect(language(await authorize(tenant, {}, { 'accept-language': 'en' }))).toBe('fr');
    expect(language(await authorize(tenant))).toBe('fr');
    expect(
      language(await authorize(tenant, { ui_locales: 'ar' }, { 'accept-language': 'en' })),
    ).toBe('ar');
  });

  it('leaves the browser to decide when the tenant set none', async () => {
    const tenant = await seedTenant('nodefault', {
      supportedLocales: ['en', 'fr'],
      defaultLocale: null,
    });
    expect(language(await authorize(tenant, {}, { 'accept-language': 'fr' }))).toBe('fr');
  });
});

describe('a tenant’s message overrides', () => {
  it('replace the catalogue’s text in the locale they were written for', async () => {
    const tenant = await seedTenant('worded', {
      supportedLocales: ['en', 'fr'],
      defaultLocale: null,
    });
    await override(tenant, 'fr', 'login.title', 'Entrez chez Acme');
    const fr = await authorize(tenant, { ui_locales: 'fr' });
    expect(fr.body).toContain('Entrez chez Acme');
    const en = await authorize(tenant, { ui_locales: 'en' });
    expect(en.body).not.toContain('Entrez chez Acme');
    expect(en.body).toContain('Sign in');
  });

  it('are escaped, never rendered, whatever they hold', async () => {
    const tenant = await seedTenant('markup', { supportedLocales: ['en'], defaultLocale: null });
    await override(tenant, 'en', 'login.title', '<script>alert(1)</script><b>Hi</b> "q" & more');
    const res = await authorize(tenant);
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).not.toContain('<b>Hi</b>');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body).toContain('&amp; more');
  });

  it('stay with their tenant', async () => {
    const mine = await seedTenant('mine', { supportedLocales: ['en'], defaultLocale: null });
    const theirs = await seedTenant('theirs', { supportedLocales: ['en'], defaultLocale: null });
    await override(theirs, 'en', 'login.title', 'Their private wording');
    expect((await authorize(mine)).body).not.toContain('Their private wording');
    expect((await authorize(theirs)).body).toContain('Their private wording');
  });

  it('give way to the catalogue when the stored text cannot be formatted', async () => {
    const tenant = await seedTenant('broken', { supportedLocales: ['en'], defaultLocale: null });
    await override(tenant, 'en', 'login.title', 'Welcome {nobody');
    await override(tenant, 'en', 'login.context', 'for {nothing}');
    const res = await authorize(tenant);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sign in');
    expect(res.body).not.toContain('Welcome {nobody');
  });

  it('reach the pages a rejected attempt re-renders', async () => {
    const tenant = await seedTenant('rejected', { supportedLocales: ['en'], defaultLocale: null });
    await override(tenant, 'en', 'login.title', 'Acme door');
    const first = await authorize(tenant);
    const authSessionId = /name="auth_session_id" value="([^"]+)"/u.exec(first.body)?.[1] ?? '';
    const again = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant.name}/login-actions/authenticate`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        auth_session_id: authSessionId,
        username: 'nobody',
        password: 'wrong',
      }).toString(),
    });
    expect(again.body).toContain('Acme door');
  });
});
