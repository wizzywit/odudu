import {
  generateSigningKey,
  generateTotpSecret,
  signingKeys,
  totpCode,
  totpCounter,
  type SigningKeyRecord,
} from '@odudu/crypto';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  userRepository,
  users,
} from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { authenticationSessionRepository, provisionTenant, sessions } from '@odudu/authn-flows';
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

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'amr-claim-client';
const CLIENT_SECRET = 'amr-claim-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function setupTenant(name: string): Promise<string> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'amr claim test client',
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
  return tenantId;
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

// Two cookies travel on a successful login now (session-cookie.ts, the one
// authority): the ephemeral list and the persistent one. This walks the
// browser's SSO session, never the remembered one, which stays empty until
// a login can ask to be remembered.
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

async function redeemCode(tenantName: string, code: string): Promise<{ id_token: string }> {
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
  return res.json<{ id_token: string }>();
}

// Signs USERNAME/PASSWORD in against a fresh authorization request, all the
// way through to a redeemed grant, and returns the ID token plus the SSO
// session cookie the login established.
async function signInAndRedeem(
  tenantName: string,
): Promise<{ idToken: string; cookie: string; sessionId: string }> {
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
  const sessionId = cookie.split('=')[1];
  if (sessionId === undefined) throw new Error('expected a session id in the cookie');

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const { id_token: idToken } = await redeemCode(tenantName, code);
  return { idToken, cookie, sessionId };
}

// Reuses the SSO session cookie against a fresh authorization request — no
// login form, no `advance` — so the resulting ID token's `amr`/`acr` can
// only have come from what `authenticators` the session row itself carries.
async function reuseAndRedeem(tenantName: string, cookie: string): Promise<{ idToken: string }> {
  const res = await http.inject({ url: authorizeUrl(tenantName), headers: { cookie } });
  if (res.statusCode !== 302) {
    throw new Error(`expected session reuse to redirect, got ${String(res.statusCode)}`);
  }
  const code = new URL(locationHeader(res)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the reuse redirect');
  const { id_token: idToken } = await redeemCode(tenantName, code);
  return { idToken };
}

// A TOTP credential for the tenant's one user, written as a fixture rather
// than enrolled through the form: what this suite is about is what the
// resulting token says, not how the secret got there.
async function enrolTotp(tenantId: string): Promise<string> {
  const secret = generateTotpSecret();
  await withTenant(app.db, tenantId, async (tx) => {
    const found = await userRepository(tx).byUsername(USERNAME);
    if (found === null) throw new Error('expected the seeded user');
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: found.subject.id,
      type: 'totp',
      secret: { kind: 'totp', secret, digits: 6, lastStep: 0 },
    });
  });
  return secret;
}

async function startAuthSession(tenantName: string): Promise<string> {
  const authorize = await http.inject({ url: authorizeUrl(tenantName) });
  if (authorize.statusCode !== 200) {
    throw new Error(
      `expected /authorize to render the login form, got ${String(authorize.statusCode)}`,
    );
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');
  return authSessionId;
}

function submit(
  tenantName: string,
  fields: Record<string, string>,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function setSessionAuthenticators(
  sessionId: string,
  authenticators: string[],
): Promise<void> {
  await owner.db.update(sessions).set({ authenticators }).where(eq(sessions.id, sessionId));
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

describe('amr and acr, from the executions that actually ran', () => {
  it('[OIDC-CORE-2-10] a password-only login carries amr: ["pwd"] and acr: "1"', async () => {
    const tenantName = `amr-claim-${newId()}`;
    await setupTenant(tenantName);

    const { idToken } = await signInAndRedeem(tenantName);

    expect(jwtPayload(idToken).amr).toEqual(['pwd']);
    expect(jwtPayload(idToken).acr).toBe('1');
  });

  // Two real factors, through the real issuance path: a password
  // submission that answers with the code form rather than a redirect, and
  // a second submission that carries the code. Nothing about the resulting
  // session is written by the test — `amr` can only name both factors if
  // the flow engine accumulated them and establishSession carried them.
  it('a password-plus-otp login carries amr: ["otp","pwd"] and acr: "2"', async () => {
    const tenantName = `amr-claim-mfa-${newId()}`;
    const tenantId = await setupTenant(tenantName);
    const secret = await enrolTotp(tenantId);

    const authSessionId = await startAuthSession(tenantName);
    const challenged = await submit(tenantName, {
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(challenged.statusCode).toBe(200);
    expect(challenged.body).toContain('name="code"');

    const completed = await submit(tenantName, {
      auth_session_id: authSessionId,
      code: totpCode(secret, totpCounter(new Date())),
    });
    expect(completed.statusCode).toBe(302);
    const code = new URL(locationHeader(completed)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the login redirect');

    const { id_token: idToken } = await redeemCode(tenantName, code);

    expect(jwtPayload(idToken).amr).toEqual(['otp', 'pwd']);
    expect(jwtPayload(idToken).acr).toBe('2');
  });

  // passkey has no runtime yet (executor.ts's AUTHENTICATORS), so this
  // login is driven the way the session it would have produced actually
  // reaches token issuance: by writing `sessions.authenticators` directly,
  // the same column establishSession would have populated, and reusing that
  // session rather than logging in again.
  it('a passkey login carries amr: ["hwk","user"] and acr: "2"', async () => {
    const tenantName = `amr-claim-passkey-${newId()}`;
    await setupTenant(tenantName);

    const { cookie, sessionId } = await signInAndRedeem(tenantName);
    await setSessionAuthenticators(sessionId, ['passkey']);

    const { idToken } = await reuseAndRedeem(tenantName, cookie);

    expect(jwtPayload(idToken).amr).toEqual(['hwk', 'user']);
    expect(jwtPayload(idToken).acr).toBe('2');
  });

  it('a session recorded before this column existed carries no amr and no acr', async () => {
    const tenantName = `amr-claim-legacy-${newId()}`;
    await setupTenant(tenantName);

    const { cookie, sessionId } = await signInAndRedeem(tenantName);
    await setSessionAuthenticators(sessionId, []);

    const { idToken } = await reuseAndRedeem(tenantName, cookie);

    expect(jwtPayload(idToken).amr).toBeUndefined();
    expect(jwtPayload(idToken).acr).toBeUndefined();
  });

  // Seeds `satisfied` with `otp` directly (the same artifice the two tests
  // above use for a factor with no runtime), then completes the login with
  // a real password submission. `dispatchNext` ignores the unrecognised
  // name; the resulting token can only report both factors if `advance()`
  // actually prepends what was already satisfied, not just the factor
  // that just ran.
  it('a factor satisfied before this submission is still in the token amr/acr', async () => {
    const tenantName = `amr-claim-accumulation-${newId()}`;
    const tenantId = await setupTenant(tenantName);

    const authorize = await http.inject({ url: authorizeUrl(tenantName) });
    if (authorize.statusCode !== 200) {
      throw new Error(
        `expected /authorize to render the login form, got ${String(authorize.statusCode)}`,
      );
    }
    const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
    const authSessionId = match?.[1];
    if (authSessionId === undefined) {
      throw new Error('auth_session_id not found in the login form');
    }

    await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).recordSatisfied(authSessionId, 'otp'),
    );

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
    const code = new URL(locationHeader(submitted)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the login redirect');

    const { id_token: idToken } = await redeemCode(tenantName, code);

    expect(jwtPayload(idToken).amr).toEqual(['otp', 'pwd']);
    expect(jwtPayload(idToken).acr).toBe('2');
  });
});
