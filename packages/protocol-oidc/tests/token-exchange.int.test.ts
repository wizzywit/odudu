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
import { provisionTenant, type SessionLifespans } from '@odudu/authn-flows';
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
import { resolveExchangeToken, type ResolveDeps } from '#/usecase/token-exchange-subject';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'token-exchange-client';
const CLIENT_SECRET = 'token-exchange-client-secret';
// Named but never registered as a real client row: an id_token exchange's
// audience check is a string comparison against the requesting client_id,
// with no other client fact behind it.
const OTHER_CLIENT_ID = 'token-exchange-other-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 23);

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// Generous enough that no session under test idles out from underneath a
// liveness check — this file's own resolution rules are what each test
// pins, not the idle window.
const GENEROUS_LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};

let TENANT: string;
let TENANT_ID: string;
let resolveDeps: ResolveDeps;

async function setupTenant(name: string, tenantId: string): Promise<void> {
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Token exchange test client',
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

// Decodes without verifying: used only to read what the issuance path
// minted, never to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function issuerOf(claims: Record<string, unknown>): string {
  const iss = claims.iss;
  if (typeof iss !== 'string') throw new Error('expected a string iss claim');
  return iss;
}

function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

async function redeemCode(
  tenantName: string,
  code: string,
): Promise<{ access_token: string; id_token: string; refresh_token: string }> {
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
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(res.statusCode)}`);
  }
  return res.json<{ access_token: string; id_token: string; refresh_token: string }>();
}

interface LoggedInToken {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  sessionId: string;
  subjectId: string;
  grantId: string;
}

// Signs USERNAME/PASSWORD in against a fresh authorization request, all the
// way through to a redeemed grant — the fixture shape resource-token.int
// .test.ts and sid-claim.int.test.ts both use, extended to also read back
// the subject and grant a resolution should recover.
async function loginAndGetToken(tenantName = TENANT): Promise<LoggedInToken> {
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
  if (submitted.statusCode !== 302) {
    throw new Error(`expected a successful login, got ${String(submitted.statusCode)}`);
  }
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  const sessionId = cookie.split('=')[1];
  if (sessionId === undefined) throw new Error('expected a session id in the cookie');

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const redeemed = await redeemCode(tenantName, code);
  const accessClaims = decode(redeemed.access_token);
  const subjectId = accessClaims.sub;
  const grantId = accessClaims.grant_id;
  if (typeof subjectId !== 'string' || typeof grantId !== 'string') {
    throw new Error('expected sub and grant_id on the minted access token');
  }

  return {
    accessToken: redeemed.access_token,
    idToken: redeemed.id_token,
    refreshToken: redeemed.refresh_token,
    sessionId,
    subjectId,
    grantId,
  };
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
  httpApp = http;

  TENANT = `token-exchange-${newId()}`;
  TENANT_ID = newId();
  await setupTenant(TENANT, TENANT_ID);

  const seed = await loginAndGetToken(TENANT);
  resolveDeps = {
    issuer: issuerOf(decode(seed.accessToken)),
    requestingClientId: CLIENT_ID,
    lifespans: GENEROUS_LIFESPANS,
    now: new Date(),
  };
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-01] an access token as subject_token', () => {
  it('resolves to its grant subject, scope and session', async () => {
    const { accessToken, grantId, sessionId, subjectId } = await loginAndGetToken();

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', accessToken),
    );

    expect(outcome).toMatchObject({ kind: 'ok', token: { subjectId, grantId, sessionId } });
    if (outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.token.scope).toEqual(expect.arrayContaining(['openid']));
  });

  it('refuses a token whose grant was revoked', async () => {
    const { accessToken, grantId } = await loginAndGetToken();
    await withTenant(app.db, TENANT_ID, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, new Date()),
    );

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', accessToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('refuses a syntactically valid token this tenant did not sign', async () => {
    const foreignTenant = `token-exchange-foreign-${newId()}`;
    const foreignTenantId = newId();
    await setupTenant(foreignTenant, foreignTenantId);
    const { accessToken: foreignAccessToken } = await loginAndGetToken(foreignTenant);

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', foreignAccessToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});

async function rotateOnce(refreshToken: string): Promise<void> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected the rotation to succeed, got ${String(res.statusCode)}`);
  }
}

describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-02] a refresh token as subject_token', () => {
  it('resolves without consuming it, so it still refreshes afterwards', async () => {
    const { refreshToken } = await loginAndGetToken();

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'refresh_token', refreshToken),
    );
    expect(outcome.kind).toBe('ok');

    // RFC 8693 §2.1: "the act of performing a token exchange has no impact
    // on the validity of the subject token".
    const refreshed = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
      },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    expect(refreshed.statusCode).toBe(200);
  });

  it('refuses one already consumed by a rotation', async () => {
    const { refreshToken } = await loginAndGetToken();
    await rotateOnce(refreshToken);

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'refresh_token', refreshToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-03] an id_token as subject_token', () => {
  it('resolves when its aud names the requesting client', async () => {
    const { idToken, subjectId } = await loginAndGetToken();
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: CLIENT_ID },
        'id_token',
        idToken,
      ),
    );
    expect(outcome).toMatchObject({ kind: 'ok', token: { subjectId } });
  });

  // An ID token is an authentication receipt for one client, not a bearer
  // credential for APIs, so a holder that is not its audience may not
  // exchange it. Stricter than RFC 8693 requires.
  it('refuses when another client presents it', async () => {
    const { idToken } = await loginAndGetToken();
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: OTHER_CLIENT_ID },
        'id_token',
        idToken,
      ),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('refuses an id_token signed by another tenant', async () => {
    const foreignTenant = `token-exchange-foreign-idtoken-${newId()}`;
    const foreignTenantId = newId();
    await setupTenant(foreignTenant, foreignTenantId);
    const { idToken: foreignIdToken } = await loginAndGetToken(foreignTenant);

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: CLIENT_ID },
        'id_token',
        foreignIdToken,
      ),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});
