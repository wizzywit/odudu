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
import { provisionTenant, sessionRepository } from '@odudu/authn-flows';
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
import { authorizationCodeRepository } from '#/repository/codes';
import { tokenGrantRepository } from '#/repository/grants';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'userinfo-liveness-client';
const CLIENT_SECRET = 'userinfo-liveness-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 53);

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Tenant {
  tenantName: string;
  tenantId: string;
  clientDbId: string;
  subjectId: string;
}

async function setupTenant(name: string): Promise<Tenant> {
  const tenantId = newId();
  const clientDbId = newId();

  const subjectId = await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'UserInfo liveness test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
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
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });

    return subject.id;
  });

  return { tenantName: name, tenantId, clientDbId, subjectId };
}

function authorizeUrl(tenantName: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

function setCookieValue(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values.find((value) => !value.includes('-persistent='))?.split(';')[0];
}

function sessionIdFromCookie(cookie: string): string {
  const id = cookie.split('=')[1];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

async function redeemCode(tenantName: string, code: string): Promise<string> {
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
  return res.json<{ access_token: string }>().access_token;
}

// Signs in through the real form and redeems the code, so the access token
// carries a genuine `sid` naming a live session row.
async function signInAndRedeem(tenantName: string): Promise<{ sessionId: string; token: string }> {
  const authorize = await http.inject({ url: authorizeUrl(tenantName) });
  if (authorize.statusCode !== 200) {
    throw new Error(`expected the login form, got ${String(authorize.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found');

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
    throw new Error(`expected login to redirect, got ${String(submitted.statusCode)}`);
  }
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  const sessionId = sessionIdFromCookie(cookie);

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const token = await redeemCode(tenantName, code);
  return { sessionId, token };
}

// Mints an access token bound to no session at all — the same technique
// userinfo.adversarial.int.test.ts uses: an authorization code created
// directly, bypassing the login UI, with no `sessionId` at all. The token
// this redeems to carries no `sid`, the same shape an `offline_access`
// grant has once its session ends.
async function mintOfflineToken(tenant: Tenant): Promise<string> {
  const code = generateAuthorizationCode();
  await withTenant(app.db, tenant.tenantId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      tenantId: tenant.tenantId,
      clientId: tenant.clientDbId,
      subjectId: tenant.subjectId,
      redirectUri: REDIRECT_URI,
      scope: 'openid',
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource: [],
      claims: { idToken: {}, userinfo: {} },
    });
  });
  return redeemCode(tenant.tenantName, code);
}

function decodePayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function revokeGrantBehindToken(tenant: Tenant, token: string): Promise<void> {
  const grantId = decodePayload(token).grant_id;
  if (typeof grantId !== 'string') throw new Error('expected a grant_id claim on the token');
  await withTenant(app.db, tenant.tenantId, (tx) =>
    tokenGrantRepository(tx).revoke(grantId, new Date()),
  );
}

async function endSession(tenant: Tenant, sessionId: string): Promise<void> {
  await withTenant(app.db, tenant.tenantId, (tx) =>
    sessionRepository(tx).end(sessionId, new Date()),
  );
}

function userinfoUrl(tenantName: string): string {
  return `/tenants/${tenantName}/protocol/openid-connect/userinfo`;
}

async function userinfo(tenantName: string, token: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'GET',
    url: userinfoUrl(tenantName),
    headers: { authorization: `Bearer ${token}` },
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

describe('[ODUDU-USERINFO-LIVENESS-01] /userinfo consults the grant and the session the way /introspect does', () => {
  it('answers 200 for a live grant bound to a live session', async () => {
    const tenant = await setupTenant(`userinfo-live-${newId()}`);
    const { token } = await signInAndRedeem(tenant.tenantName);

    const res = await userinfo(tenant.tenantName, token);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ sub: string }>().sub).toBe(tenant.subjectId);
  });

  it('refuses a token whose grant this server revoked, with invalid_token', async () => {
    const tenant = await setupTenant(`userinfo-revoked-${newId()}`);
    const { token } = await signInAndRedeem(tenant.tenantName);
    await revokeGrantBehindToken(tenant, token);

    const res = await userinfo(tenant.tenantName, token);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('refuses a token whose session has ended, with invalid_token', async () => {
    const tenant = await setupTenant(`userinfo-ended-${newId()}`);
    const { sessionId, token } = await signInAndRedeem(tenant.tenantName);
    await endSession(tenant, sessionId);

    const res = await userinfo(tenant.tenantName, token);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('still answers 200 for an offline grant with no session to end at all', async () => {
    const tenant = await setupTenant(`userinfo-offline-${newId()}`);
    const token = await mintOfflineToken(tenant);
    expect(decodePayload(token).sid).toBeUndefined();

    const res = await userinfo(tenant.tenantName, token);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ sub: string }>().sub).toBe(tenant.subjectId);
  });
});

// The blind spot between "no session because it is offline" and "no
// session because there is no End-User at all": issueClientCredentialsTokens
// (token-issuance.ts) still writes a real token_grants row, with
// sessionId: null and a genuine grant_id — the same shape offline_access
// has — so the C1 check above must treat it identically rather than
// refusing it for lacking a session it was never going to have.
describe('[ODUDU-USERINFO-LIVENESS-02] client_credentials at /userinfo', () => {
  const CC_CLIENT_ID = 'userinfo-liveness-cc-client';
  const CC_CLIENT_SECRET = 'userinfo-liveness-cc-secret';

  async function setupClientCredentialsTenant(name: string): Promise<{ tenantName: string }> {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
      await tx.insert(tenants).values({ id: tenantId, name });
      await provisionTenant(tx, tenantId);

      const serviceSubject = await subjectRepository(tx).create({ tenantId, type: 'service' });
      const clientDbId = newId();
      await tx.insert(clients).values({
        id: clientDbId,
        tenantId,
        clientId: CC_CLIENT_ID,
        name: 'client_credentials liveness test client',
        type: 'confidential',
        secretHash: await hashPassword(CC_CLIENT_SECRET),
        serviceSubjectId: serviceSubject.id,
      });
      await provisionClientDefaults(tx, clientDbId);
      await clientOidcConfigRepository(tx).create({
        clientId: clientDbId,
        tenantId,
        redirectUris: [],
        grantTypes: ['client_credentials'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        // A tenant's own choice to let this client request `openid` — RFC
        // 6749 draws no line here, and this is what makes the request
        // below reach /userinfo's `openid`-scope gate at all.
        clientCredentialsScopes: ['openid'],
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
    return { tenantName: name };
  }

  async function requestClientCredentialsToken(tenantName: string): Promise<string> {
    const form = new URLSearchParams({ grant_type: 'client_credentials', scope: 'openid' });
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
    return res.json<{ access_token: string }>().access_token;
  }

  it('answers 200: a real grant with no session, minted with no End-User at all', async () => {
    const tenant = await setupClientCredentialsTenant(`userinfo-cc-${newId()}`);
    const token = await requestClientCredentialsToken(tenant.tenantName);
    const payload = decodePayload(token);
    expect(payload.sid).toBeUndefined();
    expect(typeof payload.grant_id).toBe('string');

    const res = await userinfo(tenant.tenantName, token);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ sub: string }>().sub).toBe(payload.sub);
  });
});
