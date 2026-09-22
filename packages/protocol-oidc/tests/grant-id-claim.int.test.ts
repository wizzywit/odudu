import { generateSigningKey, signingKeys, type SigningKeyRecord } from '@odudu/crypto';
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
import { tokenGrantRepository } from '#/repository/grants';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'grant-id-claim-client';
const CLIENT_SECRET = 'grant-id-claim-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 13);

const CC_CLIENT_ID = 'grant-id-claim-cc-client';
const CC_CLIENT_SECRET = 'grant-id-claim-cc-client-secret';
const AUDIENCE = 'https://api.example';

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function setupTenant(name: string, tenantId: string): Promise<void> {
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'grant_id claim test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
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

    const ccClientDbId = newId();
    const serviceSubject = await subjectRepository(tx).create({ tenantId, type: 'service' });
    await tx.insert(clients).values({
      id: ccClientDbId,
      tenantId,
      clientId: CC_CLIENT_ID,
      name: 'grant_id claim client_credentials client',
      type: 'confidential',
      secretHash: await hashPassword(CC_CLIENT_SECRET),
      serviceSubjectId: serviceSubject.id,
    });
    await provisionClientDefaults(tx, ccClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: ccClientDbId,
      tenantId,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: ['reports:read'],
    });

    const generated = await generateSigningKey('ES256', KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    await tx.insert(signingKeys).values({
      id: key.id,
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
}

function authorizeUrl(tenantName: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

function setCookieValue(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values.find((value) => !value.includes('-persistent='))?.split(';')[0];
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT to have a payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function redeemCode(
  tenantName: string,
  code: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(res.statusCode)}`);
  }
  return res.json<{ access_token: string; refresh_token: string }>();
}

async function completeAuthorizationCodeFlow(
  tenantName: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const authorize = await http.inject({ url: authorizeUrl(tenantName) });
  if (authorize.statusCode !== 200) {
    throw new Error(
      `expected /authorize to render the login form, got ${String(authorize.statusCode)}`,
    );
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');

  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const submitted = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const redeemed = await redeemCode(tenantName, code);
  return { accessToken: redeemed.access_token, refreshToken: redeemed.refresh_token };
}

async function refresh(tenantName: string, refreshToken: string): Promise<{ accessToken: string }> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /token to rotate the refresh token, got ${String(res.statusCode)}`);
  }
  return { accessToken: res.json<{ access_token: string }>().access_token };
}

async function clientCredentials(tenantName: string): Promise<{ accessToken: string }> {
  const form = new URLSearchParams({ grant_type: 'client_credentials', scope: 'reports:read' });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CC_CLIENT_ID}:${CC_CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(
      `expected /token to issue a client_credentials token, got ${String(res.statusCode)}`,
    );
  }
  return { accessToken: res.json<{ access_token: string }>().access_token };
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

describe('the grant_id claim', () => {
  it('names the exact token_grants row the authorization_code redemption wrote', async () => {
    const tenantId = newId();
    const tenantName = `grant-id-claim-${tenantId}`;
    await setupTenant(tenantName, tenantId);

    const { accessToken } = await completeAuthorizationCodeFlow(tenantName);
    const grantId = jwtPayload(accessToken).grant_id;
    expect(typeof grantId).toBe('string');

    const row = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(grantId as string),
    );
    expect(row).not.toBeNull();
    expect(row?.id).toBe(grantId);
    expect(row?.revokedAt).toBeNull();
  });

  it('keeps grant_id stable across a refresh, against the one row that still exists', async () => {
    const tenantId = newId();
    const tenantName = `grant-id-claim-refresh-${tenantId}`;
    await setupTenant(tenantName, tenantId);

    const first = await completeAuthorizationCodeFlow(tenantName);
    const firstGrantId = jwtPayload(first.accessToken).grant_id;

    const rotated = await refresh(tenantName, first.refreshToken);
    const rotatedGrantId = jwtPayload(rotated.accessToken).grant_id;

    expect(rotatedGrantId).toBe(firstGrantId);

    const row = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(rotatedGrantId as string),
    );
    expect(row).not.toBeNull();
    expect(row?.id).toBe(firstGrantId);
  });

  it('gives two client_credentials issuances for the same client two distinct rows', async () => {
    const tenantId = newId();
    const tenantName = `grant-id-claim-cc-${tenantId}`;
    await setupTenant(tenantName, tenantId);

    const first = await clientCredentials(tenantName);
    const second = await clientCredentials(tenantName);
    const firstGrantId = jwtPayload(first.accessToken).grant_id;
    const secondGrantId = jwtPayload(second.accessToken).grant_id;

    expect(firstGrantId).not.toBe(secondGrantId);

    const [firstRow, secondRow] = await withTenant(app.db, tenantId, async (tx) => [
      await tokenGrantRepository(tx).byId(firstGrantId as string),
      await tokenGrantRepository(tx).byId(secondGrantId as string),
    ]);
    expect(firstRow?.id).toBe(firstGrantId);
    expect(secondRow?.id).toBe(secondGrantId);
    // The case that was previously indistinguishable: both rows share the
    // same client, subject and (absent) session — client_credentials has
    // no session — yet the claim names each one exactly.
    expect(firstRow?.clientId).toBe(secondRow?.clientId);
    expect(firstRow?.subjectId).toBe(secondRow?.subjectId);
    expect(firstRow?.sessionId).toBeNull();
    expect(secondRow?.sessionId).toBeNull();
  });
});
