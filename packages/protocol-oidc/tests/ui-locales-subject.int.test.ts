import { provisionTenant, requiredActionRepository } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
  users,
} from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
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

const CLIENT_ID = 'subject-locale-client';
const REDIRECT_URI = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Seeded {
  tenantName: string;
  tenantId: string;
  subjectId: string;
}

async function seed(options: { locale: string | null; owes?: 'update-password' }): Promise<Seeded> {
  const tenantName = `locale-${newId()}`;
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name: tenantName, supportedLocales: ['en', 'fr'] });
    await provisionTenant(tx, tenantId);
    const clientDbId = newId();
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: CLIENT_ID,
      type: 'confidential',
      secretHash: await hashPassword('unused'),
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
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx
      .insert(users)
      .values({ subjectId: subject.id, tenantId, username: 'ada', locale: options.locale });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
    });
    if (options.owes !== undefined) {
      await requiredActionRepository(tx).add(tenantId, subject.id, options.owes);
    }
    return subject.id;
  });
  return { tenantName, tenantId, subjectId };
}

function post(url: string, fields: Record<string, string>): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

const language = (res: LightMyRequestResponse): string | undefined =>
  /<html lang="([^"]*)"/u.exec(res.body)?.[1];

// The login form, then the password: what the page after the first factor
// says about the language.
async function afterFirstFactor(
  tenantName: string,
  username = 'ada',
): Promise<{ form: LightMyRequestResponse; next: LightMyRequestResponse }> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const form = await http.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const authSessionId = /name="auth_session_id" value="([^"]+)"/u.exec(form.body)?.[1] ?? '';
  const next = await post(`/tenants/${tenantName}/login-actions/authenticate`, {
    auth_session_id: authSessionId,
    username,
    password: PASSWORD,
  });
  return { form, next };
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
      kek: Buffer.alloc(32, 9),
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

describe('[ODUDU-UI-LOCALES-04] the subject locale chooses the language once the first factor is verified', () => {
  it('shows the consent page in the subject locale, and the login form in neither', async () => {
    const { tenantName } = await seed({ locale: 'fr' });
    const { form, next } = await afterFirstFactor(tenantName);

    expect(language(form)).toBe('en');
    expect(next.body).toContain('is asking for access');
    expect(language(next)).toBe('fr');
    expect(next.headers['content-language']).toBe('fr');
  });

  it('shows a required-action page in the subject locale', async () => {
    const { tenantName } = await seed({ locale: 'fr', owes: 'update-password' });
    const { next } = await afterFirstFactor(tenantName);

    expect(next.body).toContain('Change your password');
    expect(language(next)).toBe('fr');
  });

  it('does not let a failed first factor reveal the account locale', async () => {
    const { tenantName } = await seed({ locale: 'fr' });
    const { next } = await afterFirstFactor(tenantName, 'nobody');

    expect(language(next)).toBe('en');
  });

  it('gives a subject without a locale the browser language', async () => {
    const { tenantName } = await seed({ locale: null });
    const { next } = await afterFirstFactor(tenantName);

    expect(language(next)).toBe('en');
  });

  it('never reads a subject of another tenant', async () => {
    const a = await seed({ locale: null });
    const b = await seed({ locale: 'fr' });

    const foreign = await withTenant(app.db, a.tenantId, (tx) =>
      userRepository(tx).bySubjectId(b.subjectId),
    );
    expect(foreign).toBeNull();
    const own = await withTenant(app.db, b.tenantId, (tx) =>
      userRepository(tx).bySubjectId(b.subjectId),
    );
    expect(own?.locale).toBe('fr');
  });
});
