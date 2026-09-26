import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { auditRepository, type AuditEventRecord } from '@odudu/domain-audit';
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
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'audit-sessions-client';
const CLIENT_SECRET = 'audit-sessions-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const OTHER_USERNAME = 'bob';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 17);
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface SeededTenant {
  name: string;
  id: string;
  clientDbId: string;
  subjectId: string;
  otherSubjectId: string;
}

async function seedTenant(maxSessionsPerBrowser = 5): Promise<SeededTenant> {
  const name = `audit-sessions-${newId()}`;
  const id = newId();
  const clientDbId = newId();
  let subjectId = '';
  let otherSubjectId = '';
  await withTenant(app.db, id, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id, name, maxSessionsPerBrowser });
    await provisionTenant(tx, id);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId: id,
      clientId: CLIENT_ID,
      name: 'Audit sessions test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId: id,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    const passwordHash = await hashPassword(PASSWORD);
    const createUser = async (username: string): Promise<string> => {
      const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
      await tx.insert(users).values({ subjectId: subject.id, tenantId: id, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId: id,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: passwordHash },
      });
      return subject.id;
    };
    subjectId = await createUser(USERNAME);
    otherSubjectId = await createUser(OTHER_USERNAME);
    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: id,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
  });
  return { name, id, clientDbId, subjectId, otherSubjectId };
}

function authorizeUrl(tenant: SeededTenant, prompt?: 'login'): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...(prompt === undefined ? {} : { prompt }),
  });
  return `/tenants/${tenant.name}/protocol/openid-connect/auth?${params.toString()}`;
}

function cookieList(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

function mergeCookies(jar: Map<string, string>, res: LightMyRequestResponse): void {
  for (const set of cookieList(res)) {
    const pair = set.split(';')[0];
    const eq = pair?.indexOf('=');
    if (pair === undefined || eq === undefined || eq === -1) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>): Record<string, string> {
  const value = [...jar].map(([name, v]) => `${name}=${v}`).join('; ');
  return value.length > 0 ? { cookie: value } : {};
}

async function startAuthSession(tenant: SeededTenant, jar: Map<string, string>): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenant, 'login'), headers: cookieHeader(jar) });
  expect(res.statusCode).toBe(200);
  const value = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

function submitLogin(
  tenant: SeededTenant,
  authSessionId: string,
  jar: Map<string, string>,
  requestId: string,
  username = USERNAME,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username,
      password: PASSWORD,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-request-id': requestId,
      ...cookieHeader(jar),
    },
  });
}

async function login(
  tenant: SeededTenant,
  jar: Map<string, string>,
  requestId = `audit-sessions-${newId()}`,
  username = USERNAME,
): Promise<LightMyRequestResponse> {
  const authSessionId = await startAuthSession(tenant, jar);
  const res = await submitLogin(tenant, authSessionId, jar, requestId, username);
  expect(res.statusCode).toBe(302);
  mergeCookies(jar, res);
  return res;
}

function codeFrom(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the redirect');
  return code;
}

async function idTokenFor(tenant: SeededTenant, code: string): Promise<string> {
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ id_token: string }>().id_token;
}

async function sidOfIdTokenFor(tenant: SeededTenant, code: string): Promise<unknown> {
  const payload = (await idTokenFor(tenant, code)).split('.')[1];
  if (payload === undefined) throw new Error('malformed id_token');
  const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof claims !== 'object' || claims === null || !('sid' in claims)) return undefined;
  return claims.sid;
}

async function sessionRows(tenant: SeededTenant, action: string): Promise<AuditEventRecord[]> {
  return withTenant(app.db, tenant.id, (tx) =>
    auditRepository(tx).list({ eventType: 'session', action, limit: 50 }),
  );
}

function onlyRow(rows: readonly AuditEventRecord[]): AuditEventRecord {
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error('expected one row');
  return row;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);

  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify({ requestIdHeader: 'x-request-id' });
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: ownerHandle,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
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

describe('session.created', () => {
  it('is written once by a login, naming the sid the ID token carries', async () => {
    const tenant = await seedTenant();
    const requestId = `audit-sessions-login-${newId()}`;
    const res = await login(tenant, new Map(), requestId);

    const row = onlyRow(await sessionRows(tenant, 'session.created'));
    expect(row).toMatchObject({
      eventType: 'session',
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      actorClientId: tenant.clientDbId,
      resourceType: 'session',
      requestId,
      detail: {},
    });
    expect(row.resourceId).toBe(await sidOfIdTokenFor(tenant, codeFrom(res)));
  });

  it('is not written again when a later /authorize reuses the session', async () => {
    const tenant = await seedTenant();
    const jar = new Map<string, string>();
    await login(tenant, jar);

    const reused = await http.inject({ url: authorizeUrl(tenant), headers: cookieHeader(jar) });
    expect(reused.statusCode).toBe(302);
    codeFrom(reused);

    expect(await sessionRows(tenant, 'session.created')).toHaveLength(1);
  });

  it('is written once when the same authentication session is submitted twice at once', async () => {
    const tenant = await seedTenant();
    const jar = new Map<string, string>();
    const authSessionId = await startAuthSession(tenant, jar);

    const responses = await Promise.all([
      submitLogin(tenant, authSessionId, jar, `audit-sessions-race-a-${newId()}`),
      submitLogin(tenant, authSessionId, jar, `audit-sessions-race-b-${newId()}`),
    ]);
    const issued = responses.filter(
      (res) => res.statusCode === 302 && String(res.headers.location).includes('code='),
    );
    expect(issued).toHaveLength(1);
    const [winner] = issued;
    if (winner === undefined) throw new Error('expected one submission to issue a code');

    const row = onlyRow(await sessionRows(tenant, 'session.created'));
    expect(row.resourceId).toBe(await sidOfIdTokenFor(tenant, codeFrom(winner)));
  });
});

describe('session.ended', () => {
  it('is written with via evicted for the session a login past the cap evicts', async () => {
    const tenant = await seedTenant(1);
    const jar = new Map<string, string>();
    const requestId = `audit-sessions-evict-${newId()}`;
    await login(tenant, jar);
    const [first] = (await sessionRows(tenant, 'session.created')).map((row) => row.resourceId);

    await login(tenant, jar, requestId);

    const row = onlyRow(await sessionRows(tenant, 'session.ended'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      resourceType: 'session',
      resourceId: first,
      requestId,
      detail: { via: 'evicted' },
    });
  });

  it('names the evicted session’s own subject, not the one logging in', async () => {
    const tenant = await seedTenant(1);
    const jar = new Map<string, string>();
    await login(tenant, jar);
    const [first] = (await sessionRows(tenant, 'session.created')).map((row) => row.resourceId);

    await login(tenant, jar, undefined, OTHER_USERNAME);

    const row = onlyRow(await sessionRows(tenant, 'session.ended'));
    expect(row).toMatchObject({
      actorSubjectId: tenant.subjectId,
      resourceId: first,
      detail: { via: 'evicted' },
    });
    const created = await sessionRows(tenant, 'session.created');
    expect(created.map((r) => r.actorSubjectId).sort()).toEqual(
      [tenant.subjectId, tenant.otherSubjectId].sort(),
    );
  });

  it('is written with via logout when a matching id_token_hint ends the session at once', async () => {
    const tenant = await seedTenant();
    const jar = new Map<string, string>();
    const res = await login(tenant, jar);
    const idToken = await idTokenFor(tenant, codeFrom(res));
    const [sessionId] = (await sessionRows(tenant, 'session.created')).map((row) => row.resourceId);

    const requestId = `audit-sessions-logout-hint-${newId()}`;
    const params = new URLSearchParams({ id_token_hint: idToken, client_id: CLIENT_ID });
    const ended = await http.inject({
      url: `/tenants/${tenant.name}/protocol/openid-connect/logout?${params.toString()}`,
      headers: { 'x-request-id': requestId, ...cookieHeader(jar) },
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.body).not.toContain('name="session_id"');

    const row = onlyRow(await sessionRows(tenant, 'session.ended'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      resourceType: 'session',
      resourceId: sessionId,
      requestId,
      detail: { via: 'logout' },
    });
  });

  it('is written with via logout when a logout is confirmed', async () => {
    const tenant = await seedTenant();
    const jar = new Map<string, string>();
    await login(tenant, jar);
    const [sessionId] = (await sessionRows(tenant, 'session.created')).map((row) => row.resourceId);

    const asked = await http.inject({
      url: `/tenants/${tenant.name}/protocol/openid-connect/logout`,
      headers: cookieHeader(jar),
    });
    expect(asked.statusCode).toBe(200);
    const confirmedSessionId = /name="session_id" value="([^"]*)"/.exec(asked.body)?.[1];
    if (confirmedSessionId === undefined) throw new Error('session_id not found');
    expect(await sessionRows(tenant, 'session.ended')).toHaveLength(0);

    const requestId = `audit-sessions-logout-${newId()}`;
    const confirmed = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant.name}/protocol/openid-connect/logout`,
      payload: new URLSearchParams({ session_id: confirmedSessionId }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-request-id': requestId,
        ...cookieHeader(jar),
      },
    });
    expect(confirmed.statusCode).toBe(200);

    const row = onlyRow(await sessionRows(tenant, 'session.ended'));
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: tenant.subjectId,
      actorClientId: null,
      resourceType: 'session',
      resourceId: sessionId,
      requestId,
      detail: { via: 'logout' },
    });
  });
});
