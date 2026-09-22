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
import { provisionTenant, sessions } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

// A tenant's ordinary idle window defaults to 1800s and its remember-me idle
// window to 604_800s (packages/db/src/schema/tenants.ts). This file backs a
// live session's `last_active_at` 100_000_000ms (~27.8h) into the past —
// past the ordinary window, comfortably inside the remembered one — the
// same offset offline-access.int.test.ts's idleOutEverySession uses to put
// every session past its ordinary idle window.
const REMEMBERED_IDLE_OFFSET_MS = 100_000_000;

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'remembered-liveness-client';
const CLIENT_SECRET = 'remembered-liveness-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 41);

// RFC 7636 Appendix B's worked example — the same pair
// offline-access.int.test.ts uses, since this file also redeems the code
// it signs in for (remember-me.int.test.ts never does, so its own
// unrelated challenge/verifier never needs to match).
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function setupTenant(name: string): Promise<void> {
  const tenantId = newId();
  const issuer = `http://localhost/tenants/${name}`;
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name, rememberMeAllowed: true });
    await provisionTenant(tx, tenantId);

    const clientDbId = newId();
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'remembered liveness test client',
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
      // The issuer is always in an access token's `aud` (mintAccessToken,
      // token-issuance.ts) — registering it here lets this same client
      // introspect its own tokens without a `resource` request.
      audiences: [issuer],
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

function cookieList(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
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

// Signs in, optionally asking to be remembered, and redeems the resulting
// code — returning the session id (from the ephemeral cookie, which every
// login carries regardless of remember_me) and the issued tokens.
async function completeFlow(
  tenantName: string,
  opts: { remember: boolean },
): Promise<{ sessionId: string; access_token: string; refresh_token: string }> {
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
    ...(opts.remember ? { remember_me: 'true' } : {}),
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
  // A remembered login writes its id into the persistent cookie and clears
  // the ephemeral one (session-cookie.ts's sessionCookies): the ephemeral
  // list omits the just-created session for `remembered`, so the browser
  // would hold two IDs for one login otherwise. An ordinary login is the
  // opposite. Either way exactly one of the two carries a non-empty value.
  const ephemeral = cookieList(submitted).find(
    (c) => c.startsWith(`${tenantName}-session=`) && !c.includes('-persistent'),
  );
  const persistent = cookieList(submitted).find((c) => c.includes('-session-persistent='));
  const fromEphemeral = ephemeral?.split('=')[1]?.split(';')[0];
  const fromPersistent = persistent?.split('=')[1]?.split(';')[0];
  const sessionId =
    fromEphemeral !== undefined && fromEphemeral !== '' ? fromEphemeral : fromPersistent;
  if (sessionId === undefined || sessionId === '') {
    throw new Error('expected a session id in either cookie');
  }

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  const redeemed = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: tokenForm.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (redeemed.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(redeemed.statusCode)}`);
  }
  const body = redeemed.json<{ access_token: string; refresh_token: string }>();
  return { sessionId, access_token: body.access_token, refresh_token: body.refresh_token };
}

async function idleOutSession(sessionId: string): Promise<void> {
  await owner.db
    .update(sessions)
    .set({ lastActiveAt: new Date(Date.now() - REMEMBERED_IDLE_OFFSET_MS) })
    .where(eq(sessions.id, sessionId));
}

async function introspect(tenantName: string, token: string): Promise<{ active: boolean }> {
  const form = new URLSearchParams({ token });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token/introspect`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /introspect to answer 200, got ${String(res.statusCode)}`);
  }
  return res.json<{ active: boolean }>();
}

async function refresh(tenantName: string, refreshToken: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
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

describe('a remembered session past the ordinary idle window', () => {
  it('introspects its access token as active', async () => {
    const tenantName = `remembered-introspect-${newId()}`;
    await setupTenant(tenantName);
    const { sessionId, access_token: accessToken } = await completeFlow(tenantName, {
      remember: true,
    });

    await idleOutSession(sessionId);

    const response = await introspect(tenantName, accessToken);
    expect(response.active).toBe(true);
  });

  it('still redeems a session-bound refresh token', async () => {
    const tenantName = `remembered-refresh-${newId()}`;
    await setupTenant(tenantName);
    const { sessionId, refresh_token: refreshToken } = await completeFlow(tenantName, {
      remember: true,
    });

    await idleOutSession(sessionId);

    const response = await refresh(tenantName, refreshToken);
    expect(response.statusCode).toBe(200);
  });
});

describe('an ordinary (non-remembered) session past the ordinary idle window', () => {
  it('still introspects its access token as inactive', async () => {
    const tenantName = `ordinary-introspect-${newId()}`;
    await setupTenant(tenantName);
    const { sessionId, access_token: accessToken } = await completeFlow(tenantName, {
      remember: false,
    });

    await idleOutSession(sessionId);

    const response = await introspect(tenantName, accessToken);
    expect(response.active).toBe(false);
  });

  it('still refuses a session-bound refresh', async () => {
    const tenantName = `ordinary-refresh-${newId()}`;
    await setupTenant(tenantName);
    const { sessionId, refresh_token: refreshToken } = await completeFlow(tenantName, {
      remember: false,
    });

    await idleOutSession(sessionId);

    const response = await refresh(tenantName, refreshToken);
    expect(response.statusCode).toBe(400);
  });
});
