import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { clients, clientScopes, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTenant } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'localised-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Setup {
  clientNameI18n?: Record<string, string>;
  profileText?: { base: string | null; i18n: Record<string, string> };
  locales?: string[];
}

async function setupTenant(name: string, setup: Setup = {}): Promise<string> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name, supportedLocales: setup.locales ?? ['en', 'fr', 'fr-CA'] });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Shop',
      nameI18n: setup.clientNameI18n ?? {},
      type: 'confidential',
      secretHash: await hashPassword('secret'),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      consentRequired: true,
    });
    if (setup.profileText !== undefined) {
      await tx
        .update(clientScopes)
        .set({
          consentText: setup.profileText.base,
          consentTextI18n: setup.profileText.i18n,
        })
        .where(eq(clientScopes.name, 'profile'));
    }
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
  });
  return tenantId;
}

function authorizeUrl(tenantName: string, uiLocales: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile offline_access',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ui_locales: uiLocales,
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

async function loginPage(tenantName: string, uiLocales: string): Promise<LightMyRequestResponse> {
  const res = await http.inject({ url: authorizeUrl(tenantName, uiLocales) });
  expect(res.statusCode).toBe(200);
  return res;
}

// Signs in and returns the consent page.
async function consentPage(tenantName: string, uiLocales: string): Promise<string> {
  const login = await loginPage(tenantName, uiLocales);
  const sessionId = /name="auth_session_id" value="([^"]*)"/.exec(login.body)?.[1] ?? '';
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: sessionId,
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('login-actions/consent');
  return res.body;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
  http = Fastify();
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('per-language client and scope text on the consent page', () => {
  it('consent shows the French client name for a fr page', async () => {
    const tenant = `i18n-fr-${newId()}`;
    await setupTenant(tenant, { clientNameI18n: { fr: 'Boutique' } });
    const body = await consentPage(tenant, 'fr');
    expect(body).toContain('<bdi>Boutique</bdi>');
    expect(body).not.toContain('<bdi>Shop</bdi>');
  });

  it('falls back to the base column for a locale with no entry', async () => {
    const tenant = `i18n-base-${newId()}`;
    await setupTenant(tenant, {
      clientNameI18n: { fr: 'Boutique' },
      profileText: { base: 'See your profile', i18n: { fr: 'Voir votre profil' } },
      locales: ['en', 'fr', 'de'],
    });
    const body = await consentPage(tenant, 'de');
    expect(body).toContain('<bdi>Shop</bdi>');
    expect(body).toContain('<bdi>See your profile</bdi>');
    expect(body).not.toContain('Boutique');
  });

  it('matches fr-CA to the fr entry by lookup, and shows scope text for the language', async () => {
    const tenant = `i18n-lookup-${newId()}`;
    await setupTenant(tenant, {
      clientNameI18n: { fr: 'Boutique' },
      profileText: { base: 'See your profile', i18n: { fr: 'Voir votre profil' } },
    });
    const body = await consentPage(tenant, 'fr-CA');
    expect(body).toContain('<bdi>Boutique</bdi>');
    expect(body).toContain('<bdi>Voir votre profil</bdi>');
  });

  it('names a client in the page language on the sign-in page too', async () => {
    const tenant = `i18n-login-${newId()}`;
    await setupTenant(tenant, { clientNameI18n: { fr: 'Boutique' } });
    const login = await loginPage(tenant, 'fr');
    expect(login.body).toContain('Boutique');
    expect(login.body).not.toContain('Shop');
  });

  it('never renders a localised name or text as markup', async () => {
    const tenant = `i18n-xss-${newId()}`;
    const hostile = '</bdi><img src=x onerror=1><script>alert(1)</script>';
    await setupTenant(tenant, {
      clientNameI18n: { fr: hostile },
      profileText: { base: 'p', i18n: { fr: hostile } },
    });
    const body = await consentPage(tenant, 'fr');
    expect(body).not.toMatch(/<img|<script/u);
    expect(body).toContain('&lt;img src=x onerror=1&gt;');
    const login = await loginPage(tenant, 'fr');
    expect(login.body).not.toMatch(/<img|<script>alert/u);
  });
});
