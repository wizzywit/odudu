import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
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
import { sessionRepository, provisionTenant, type SessionLifespans } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

// `disagreeing` makes the `client_id`/hint comparison after verification
// rather than inside it, because §4 needs a disagreeing pair told apart
// from no usable hint at all, and `subjectOfIdTokenHint` collapses every
// verification failure to `null`. This file pins that the
// comparison still composes with the pre-existing `sid` check once an
// agreeing pair is in play.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_A_ID = 'client-a';
const CLIENT_B_ID = 'client-b';

// Generous enough that the session under test never idles out from
// underneath the liveness check this file makes.
const GENEROUS_LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 17);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function makeSigningKey(tenantId: string): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('ES256', KEK);
  return {
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
}

// A tenant with two clients — client-a and client-b each get their own
// authorization_code flow, so a hint can be minted "for" one or the
// other's own login rather than just carrying a different `aud` in
// isolation.
async function setupTenant(name: string): Promise<{ tenantId: string }> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);

    for (const clientId of [CLIENT_A_ID, CLIENT_B_ID]) {
      const dbId = newId();
      await tx.insert(clients).values({
        id: dbId,
        tenantId,
        clientId,
        name: `Test client ${clientId}`,
        type: 'confidential',
        secretHash: await hashPassword(`${clientId}-secret`),
      });
      await provisionClientDefaults(tx, dbId);
      await clientOidcConfigRepository(tx).create({
        clientId: dbId,
        tenantId,
        redirectUris: [REDIRECT_URI],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
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

    const key = await makeSigningKey(tenantId);
    signingKeyOf.set(name, key);
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

async function issuerFor(tenantName: string): Promise<string> {
  const res = await http.inject({
    url: `/tenants/${tenantName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function mintHint(
  tenantName: string,
  aud: string,
  sub: string,
  sid: string,
): Promise<string> {
  const key = signingKeyOf.get(tenantName);
  if (key === undefined) throw new Error(`no signing key for ${tenantName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { iss: await issuerFor(tenantName), aud, sub, sid, iat: now, exp: now + 300 },
    { key, kek: KEK },
  );
}

function authorizeUrl(tenantName: string, clientId: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
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
  const id = cookie.split('=')[1]?.split(':')[0];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

// Signs USERNAME/PASSWORD in against the named client's own parked
// request and returns the SSO session cookie the login redirect set.
async function signIn(tenantName: string, clientId: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenantName, clientId) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
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
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  return cookie;
}

function logoutUrl(tenantName: string, overrides: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/tenants/${tenantName}/protocol/openid-connect/logout?${query.toString()}`;
}

async function sessionIsStillLive(tenantId: string, sessionId: string): Promise<boolean> {
  const row = await withTenant(app.db, tenantId, (tx) =>
    sessionRepository(tx).liveById(sessionId, GENEROUS_LIFESPANS, new Date()),
  );
  return row !== null;
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

describe('/logout checks an id_token_hint against the client_id beside it', () => {
  it('ends the session for a hint naming the client that asked', async () => {
    const tenantName = `logout-hint-aud-match-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const cookie = await signIn(tenantName, CLIENT_A_ID);
    const sessionId = sessionIdFromCookie(cookie);
    const hint = await mintHint(tenantName, CLIENT_A_ID, subjectId, sessionId);

    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint, client_id: CLIENT_A_ID }),
      headers: { cookie },
    });

    // No post_logout_redirect_uri was requested, so ending the session
    // renders the logged-out page rather than redirecting away from it.
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Signed out</title>');
    expect(await sessionIsStillLive(tenantId, sessionId)).toBe(false);
  });

  // A disagreeing client_id/aud pair is already pinned in
  // logout.int.test.ts's "[OIDC-RPINITIATED-2-04]" suite. The property
  // worth pinning here is that agreement between client_id and the
  // hint's `aud` is necessary but not sufficient: the hint still has to
  // name the session actually live in this request's own browser, not
  // merely one belonging to the same subject.
  it('an agreeing client_id and hint audience does not end a session the hint names for a different login', async () => {
    const tenantName = `logout-hint-aud-agree-wrong-session-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);

    // Two live sessions in the same browser: one from client-a's own
    // login, kept as this request's cookie, and one from client-b's,
    // named only by the hint.
    const cookieA = await signIn(tenantName, CLIENT_A_ID);
    const sessionA = sessionIdFromCookie(cookieA);
    const cookieB = await signIn(tenantName, CLIENT_B_ID);
    const sessionB = sessionIdFromCookie(cookieB);

    const hint = await mintHint(tenantName, CLIENT_B_ID, subjectId, sessionB);

    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint, client_id: CLIENT_B_ID }),
      headers: { cookie: cookieA },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(await sessionIsStillLive(tenantId, sessionA)).toBe(true);
    expect(await sessionIsStillLive(tenantId, sessionB)).toBe(true);
  });

  // A hint with no client_id names no claim to refute, so OIDC Core
  // §3.1.2.2 still lets it identify the session on its own
  // (RP-Initiated Logout §2) — a regression guard, not new behaviour.
  it('regression guard: a hint alone, with no client_id, still ends the session it names', async () => {
    const tenantName = `logout-hint-no-clientid-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const cookie = await signIn(tenantName, CLIENT_A_ID);
    const sessionId = sessionIdFromCookie(cookie);
    const hint = await mintHint(tenantName, CLIENT_A_ID, subjectId, sessionId);

    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Signed out</title>');
    expect(await sessionIsStillLive(tenantId, sessionId)).toBe(false);
  });

  // A hint with no `aud` claim at all, sent beside a client_id, is
  // refused the same way a disagreeing one is: audiencesOf returns `[]`
  // for an absent claim, so `disagreeing` is already true against it.
  // Verification does not enforce this itself — only a named audience
  // makes jose require the claim — so this is the one place the check
  // still runs entirely in `disagreeing`, not in any earlier throw.
  it('refuses a hint with no aud claim at all, once a client_id is given', async () => {
    const tenantName = `logout-hint-no-aud-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const cookie = await signIn(tenantName, CLIENT_A_ID);
    const sessionId = sessionIdFromCookie(cookie);

    const key = signingKeyOf.get(tenantName);
    if (key === undefined) throw new Error(`no signing key for ${tenantName}`);
    const now = Math.floor(Date.now() / 1000);
    const hintWithNoAud = await signJwt(
      {
        iss: await issuerFor(tenantName),
        sub: subjectId,
        sid: sessionId,
        iat: now,
        exp: now + 300,
      },
      { key, kek: KEK },
    );

    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hintWithNoAud, client_id: CLIENT_A_ID }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(await sessionIsStillLive(tenantId, sessionId)).toBe(true);
  });
});
