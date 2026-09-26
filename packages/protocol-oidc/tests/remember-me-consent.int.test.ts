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
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTenant, sessions } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

// handleLoginSubmission's 'consent' branch parks the already-gated
// `remember_me` choice on the authentication session (recordRememberMe,
// PendingRequest.rememberMe) precisely because consent-submission.ts's
// own door completes the login without ever asking the field again. This
// is the test that would have caught it silently defaulting to `false`.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'remember-me-consent-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const REMEMBER_ME_MAX_SECONDS = 2_592_000;

async function setupTenant(name: string): Promise<string> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name,
      rememberMeAllowed: true,
      rememberMeMaxSeconds: REMEMBER_ME_MAX_SECONDS,
    });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Remember-me consent test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      // The one setting under test: a client this browser has never
      // consented to, so the login form's own success path cannot be the
      // one that establishes the session — the consent POST has to be.
      consentRequired: true,
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
  });
  return tenantId;
}

function authorizeUrl(tenantName: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

async function startAuthSession(tenantName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenantName) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

function cookieList(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
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

describe('remember me, carried across a consent-requiring client', () => {
  it('remembers the login even though consent completes it, not the login form', async () => {
    const tenantName = `tenant-${newId()}`;
    await setupTenant(tenantName);

    const authSessionId = await startAuthSession(tenantName);
    const loginForm = new URLSearchParams({
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
      remember_me: 'true',
    });
    const loginRes = await http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/authenticate`,
      payload: loginForm.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    // The login form's own response never establishes anything here — no
    // set-cookie, no location — the exact state the field's choice could
    // otherwise get lost in.
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body).toContain('login-actions/consent');
    expect(loginRes.headers['set-cookie']).toBeUndefined();

    const consentForm = new URLSearchParams({ auth_session_id: authSessionId, decision: 'allow' });
    const consentRes = await http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/consent`,
      payload: consentForm.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(consentRes.statusCode).toBe(302);
    const cookies = cookieList(consentRes);
    const persistent = cookies.find((c) => c.includes('-session-persistent='));
    const ephemeral = cookies.find(
      (c) => c.startsWith(`${tenantName}-session=`) && !c.includes('-persistent'),
    );
    if (persistent === undefined || ephemeral === undefined) {
      throw new Error(`expected both cookies, got: ${cookies.join(' | ')}`);
    }
    expect(persistent).toContain(`Max-Age=${String(REMEMBER_ME_MAX_SECONDS)}`);
    expect(ephemeral).toContain('Max-Age=0');

    const sessionId = persistent.split('=')[1]?.split(';')[0]?.split(':')[0];
    if (sessionId === undefined) throw new Error('expected a session id in the persistent cookie');
    const rows = await owner.db
      .select({ remembered: sessions.remembered })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(rows[0]?.remembered).toBe(true);
  });
});
