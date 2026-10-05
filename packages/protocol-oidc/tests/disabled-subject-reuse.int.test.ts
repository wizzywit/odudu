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
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTenant, sessions } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

// A subject disabled after signing in must get no code from the SSO
// session they left behind, at /authorize or at the account chooser.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'disabled-reuse-client';
const REDIRECT_URI = 'https://app.example/callback';
const ALICE_USERNAME = 'alice';
const ALICE_PASSWORD = 'correct horse battery staple';
const BOB_USERNAME = 'bob';
const BOB_PASSWORD = 'a different passphrase entirely';
const CAROL_USERNAME = 'carol';
const CAROL_PASSWORD = 'yet another passphrase again';

async function setupTenant(name: string): Promise<{ tenantId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    // sso_session_idle_seconds raised well past the tenant's default
    // 30-minute login_ttl_seconds for an authentication session, so the one
    // expiry test below can advance past the latter without the SSO
    // session itself going idle-expired and confounding the result.
    await tx.insert(tenants).values({
      id: tenantId,
      name,
      maxSessionsPerBrowser: 10,
      ssoSessionIdleSeconds: 7_200,
    });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Select-account test client',
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
    });
    for (const [username, password] of [
      [ALICE_USERNAME, ALICE_PASSWORD],
      [BOB_USERNAME, BOB_PASSWORD],
      [CAROL_USERNAME, CAROL_PASSWORD],
    ] as const) {
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: await hashPassword(password) },
      });
    }
  });
  return { tenantId };
}

async function subjectIdOf(tenantId: string, username: string): Promise<string> {
  const rows = await owner.db
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in tenant ${tenantId}`);
  return row.subjectId;
}

async function liveSessionIdOf(tenantId: string, subjectId: string): Promise<string> {
  const rows = await owner.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.subjectId, subjectId)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no live session for subject ${subjectId}`);
  return row.id;
}

function authorizeUrl(
  tenantName: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

function cookieList(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

// A real browser merges each Set-Cookie's name=value pair into the Cookie
// header of its next request.
function mergeCookies(jar: Map<string, string>, res: LightMyRequestResponse): void {
  for (const set of cookieList(res)) {
    const pair = set.split(';')[0];
    const index = pair?.indexOf('=');
    if (pair === undefined || index === undefined || index === -1) continue;
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractAuthSessionId(body: string): string {
  const match = /name="auth_session_id" value="([^"]*)"/.exec(body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered page');
  return value;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

// Signs a username/password in against a fresh authorization request,
// prompt=login forcing the form even once the jar already holds a live SSO
// session for somebody else — a repeat visit that reused it would never
// submit credentials again, and callers need every login here to.
async function login(
  tenantName: string,
  jar: Map<string, string>,
  username: string,
  password: string,
  instance: FastifyInstance = http,
): Promise<LightMyRequestResponse> {
  const cookie = cookieHeader(jar);
  const started = await instance.inject({
    url: authorizeUrl(tenantName, { prompt: 'login' }),
    headers: cookie.length > 0 ? { cookie } : {},
  });
  if (started.statusCode !== 200) {
    throw new Error(
      `expected /authorize to render the login form, got ${String(started.statusCode)}`,
    );
  }
  const authSessionId = extractAuthSessionId(started.body);

  const form = new URLSearchParams({ auth_session_id: authSessionId, username, password });
  const res = await instance.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie.length > 0 ? { cookie } : {}),
    },
  });
  expect(res.statusCode).toBe(302);
  mergeCookies(jar, res);
  return res;
}

async function postSelectAccount(
  tenantName: string,
  jar: Map<string, string>,
  fields: Record<string, string | undefined>,
  instance: FastifyInstance = http,
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(key, value);
  }
  return instance.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/select-account`,
    payload: params.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
    },
  });
}

function postLogin(
  tenantName: string,
  jar: Map<string, string>,
  authSessionId: string,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username: ALICE_USERNAME,
      password: ALICE_PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
  });
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

async function disable(tenantId: string, subjectId: string): Promise<void> {
  await withTenant(app.db, tenantId, (tx) => subjectRepository(tx).setEnabled(subjectId, false));
}

function isLoginForm(res: LightMyRequestResponse): boolean {
  return res.statusCode === 200 && res.body.includes('name="password"');
}

describe('a disabled subject at /authorize', () => {
  it('is shown the login form, not given a code, from the SSO session it left', async () => {
    const tenantName = `disabled-reuse-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const jar = new Map<string, string>();
    await login(tenantName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    const request = { url: authorizeUrl(tenantName), headers: { cookie: cookieHeader(jar) } };
    expect((await http.inject(request)).statusCode).toBe(302);

    await disable(tenantId, await subjectIdOf(tenantId, ALICE_USERNAME));

    const res = await http.inject(request);
    expect(isLoginForm(res), res.body).toBe(true);
    expect(res.headers.location).toBeUndefined();

    const submitted = await postLogin(tenantName, jar, extractAuthSessionId(res.body));
    expect(submitted.headers.location ?? '').not.toContain('code=');
  });

  it('is answered login_required under prompt=none', async () => {
    const tenantName = `disabled-reuse-none-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const jar = new Map<string, string>();
    await login(tenantName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await disable(tenantId, await subjectIdOf(tenantId, ALICE_USERNAME));

    const res = await http.inject({
      url: authorizeUrl(tenantName, { prompt: 'none' }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('is not offered by the account chooser, and a stale choice of it gets no code', async () => {
    const tenantName = `disabled-reuse-chooser-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const alice = await subjectIdOf(tenantId, ALICE_USERNAME);
    const jar = new Map<string, string>();
    await login(tenantName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(tenantName, jar, BOB_USERNAME, BOB_PASSWORD);
    const aliceSessionId = await liveSessionIdOf(tenantId, alice);
    const request = {
      url: authorizeUrl(tenantName, { prompt: 'select_account' }),
      headers: { cookie: cookieHeader(jar) },
    };

    const before = await http.inject(request);
    expect(before.body).toContain(aliceSessionId);
    const authSessionId = extractAuthSessionId(before.body);

    await disable(tenantId, alice);

    const after = await http.inject(request);
    expect(after.statusCode).toBe(200);
    expect(after.body).not.toContain(aliceSessionId);
    expect(after.body).toContain('bob');

    const chosen = await postSelectAccount(tenantName, jar, {
      auth_session_id: authSessionId,
      session_id: aliceSessionId,
    });
    expect(isLoginForm(chosen), chosen.body).toBe(true);
    expect(chosen.headers.location).toBeUndefined();
  });
});
