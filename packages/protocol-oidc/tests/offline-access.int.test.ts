import { generateSigningKey, signingKeys, type SigningKeyRecord } from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { sessions } from '@odudu/authn-flows';
import {
  clientScopeAssignments,
  clientScopeRepository,
  clients,
  provisionRealmDefaults,
} from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrants } from '#/schema/token-grants';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'offline-access-client';
const CLIENT_SECRET = 'offline-access-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 13);

// RFC 7636 Appendix B's worked example, reused for every authorization
// request in this file — a single code_challenge/code_verifier pair is
// fine to share across requests, since PKCE only ever binds one code to
// one redemption.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function assignScopes(
  tx: RealmScopedDatabase,
  clientDbId: string,
  scopeNames: readonly string[],
): Promise<void> {
  const repository = clientScopeRepository(tx);
  for (const name of scopeNames) {
    const scope = await repository.byName(name);
    if (scope === null) throw new Error(`realm does not define scope ${name}`);
    await repository.assign(clientDbId, scope.id, 'default');
  }
}

// No repository method withdraws an assignment (none exists as of this
// task) — this is the one test that needs to, to show the resolved scope
// at redemption, not the one /authorize accepted, is the authority.
async function unassignScope(realmId: string, scopeName: string): Promise<void> {
  await withRealm(app.db, realmId, async (tx) => {
    const scope = await clientScopeRepository(tx).byName(scopeName);
    if (scope === null) throw new Error(`realm does not define scope ${scopeName}`);
    await tx
      .delete(clientScopeAssignments)
      .where(eq(clientScopeAssignments.clientScopeId, scope.id));
  });
}

// Every test gets its own realm and client, so which scopes the client is
// assigned — the one thing each test case varies — never leaks between
// them.
async function setupRealm(
  name: string,
  assignedScopes: readonly string[],
): Promise<{ realmId: string; subjectId: string }> {
  const realmId = newId();
  const clientDbId = newId();
  let subjectId = '';
  await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealmDefaults(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'offline access test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await assignScopes(tx, clientDbId, assignedScopes);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    subjectId = subject.id;
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: await hashPassword(PASSWORD),
    });

    const generated = await generateSigningKey('ES256', KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      realmId,
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
      realmId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
  return { realmId, subjectId };
}

function authorizeUrl(
  realmName: string,
  scope: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/realms/${realmName}/protocol/openid-connect/auth?${query.toString()}`;
}

function setCookieValue(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  return typeof raw === 'string' ? raw.split(';')[0] : undefined;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

async function redeemCode(
  realmName: string,
  code: string,
): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(res.statusCode)}`);
  }
  return res.json<{ access_token: string; refresh_token: string; scope: string }>();
}

// Signs USERNAME/PASSWORD in against a fresh authorization request and
// returns the cookie and code the login redirect carried, stopping short of
// redemption — the one test in this file that withdraws a scope assignment
// between the two needs that seam.
async function signIn(realmName: string, scope: string): Promise<{ cookie: string; code: string }> {
  const authorize = await http.inject({ url: authorizeUrl(realmName, scope) });
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
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  return { cookie, code };
}

// Signs in and redeems in one step, for every test that has no reason to
// pause in between.
async function completeFlow(
  realmName: string,
  scope: string,
): Promise<{ sessionId: string; access_token: string; refresh_token: string; scope: string }> {
  const { cookie, code } = await signIn(realmName, scope);
  const sessionId = cookie.split('=')[1];
  if (sessionId === undefined) throw new Error('expected a session id in the cookie');
  const redeemed = await redeemCode(realmName, code);
  return { sessionId, ...redeemed };
}

// A live session cookie completes a second authorization request with no
// login page rendered — this is how one browser session ends up owning
// both a session-bound grant and an offline one.
async function reuseSession(
  realmName: string,
  cookie: string,
  scope: string,
): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const res = await http.inject({ url: authorizeUrl(realmName, scope), headers: { cookie } });
  if (res.statusCode !== 302) {
    throw new Error(`expected the live session to reuse, got ${String(res.statusCode)}`);
  }
  const code = new URL(locationHeader(res)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the reused-session redirect');
  return redeemCode(realmName, code);
}

async function grantsForSubject(
  realmId: string,
  subjectId: string,
): Promise<{ sessionId: string | null; scope: string }[]> {
  return withRealm(app.db, realmId, (tx) =>
    tx
      .select({ sessionId: tokenGrants.sessionId, scope: tokenGrants.scope })
      .from(tokenGrants)
      .where(eq(tokenGrants.subjectId, subjectId)),
  );
}

async function refresh(
  realmName: string,
  refreshToken: string,
): Promise<{ token_type: string; access_token: string }> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw res.json<{ error: string }>();
  }
  return res.json<{ token_type: string; access_token: string }>();
}

async function logoutViaConfirmation(realmName: string, cookie: string): Promise<void> {
  const res = await http.inject({
    url: `/realms/${realmName}/protocol/openid-connect/logout`,
    headers: { cookie },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected the confirmation page, got ${String(res.statusCode)}`);
  }
  const match = /name="session_id" value="([^"]*)"/.exec(res.body);
  const confirmedSessionId = match?.[1];
  if (confirmedSessionId === undefined) {
    throw new Error('session_id not found in the confirmation form');
  }
  const form = new URLSearchParams({ session_id: confirmedSessionId });
  const confirmed = await http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/logout`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
  if (confirmed.statusCode !== 200) {
    throw new Error(
      `expected the logout confirmation to succeed, got ${String(confirmed.statusCode)}`,
    );
  }
}

// No fake clock: `isSessionLive`'s idle check reads the database's own
// `now()` (repository/sessions.ts), so a session is idled out by moving its
// `last_active_at` into the past through the owner connection, the same way
// session-reuse.int.test.ts back-dates `created_at` for `max_age`.
async function idleOutEverySession(realmId: string): Promise<void> {
  await owner.db
    .update(sessions)
    .set({ lastActiveAt: new Date(Date.now() - 100_000_000) })
    .where(eq(sessions.realmId, realmId));
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
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK }));
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('offline access', () => {
  it('issues a grant with no session when offline_access is requested and assigned', async () => {
    const realmName = `offline-issue-${newId()}`;
    const { realmId, subjectId } = await setupRealm(realmName, ['openid', 'offline_access']);

    await completeFlow(realmName, 'openid offline_access');

    const grants = await grantsForSubject(realmId, subjectId);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.sessionId).toBeNull();
  });

  it('[ODUDU-BACKCHANNEL-2.7-02] leaves the offline grant refreshable after the session is logged out', async () => {
    const realmName = `offline-logout-${newId()}`;
    await setupRealm(realmName, ['openid', 'offline_access']);

    const first = await completeFlow(realmName, 'openid');
    const cookie = `${realmName}-session=${first.sessionId}`;
    const offline = await reuseSession(realmName, cookie, 'openid offline_access');

    await logoutViaConfirmation(realmName, cookie);

    await expect(refresh(realmName, first.refresh_token)).rejects.toMatchObject({
      error: 'invalid_grant',
    });
    await expect(refresh(realmName, offline.refresh_token)).resolves.toMatchObject({
      token_type: 'Bearer',
    });
  });

  it('leaves the offline grant refreshable after the session idles out', async () => {
    const realmName = `offline-idle-${newId()}`;
    const { realmId } = await setupRealm(realmName, ['openid', 'offline_access']);

    const { refresh_token: offlineRefreshToken } = await completeFlow(
      realmName,
      'openid offline_access',
    );
    await idleOutEverySession(realmId);

    await expect(refresh(realmName, offlineRefreshToken)).resolves.toMatchObject({
      token_type: 'Bearer',
    });
  });

  it('refuses a session-bound refresh once the session is no longer live', async () => {
    const realmName = `offline-session-dead-${newId()}`;
    const { realmId } = await setupRealm(realmName, ['openid']);

    const { refresh_token: refreshToken } = await completeFlow(realmName, 'openid');
    await idleOutEverySession(realmId);

    await expect(refresh(realmName, refreshToken)).rejects.toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('does not issue an offline grant when the client was never assigned the scope', async () => {
    // Assigned when /authorize accepts the request, withdrawn before the
    // code is redeemed — resolveScope at redemption is what must refuse
    // it, not /authorize's own upfront check, which would refuse the whole
    // request rather than narrowing it (realm-scopes.int.test.ts covers
    // that upfront refusal already).
    const realmName = `offline-unassigned-${newId()}`;
    const { realmId, subjectId } = await setupRealm(realmName, ['openid', 'offline_access']);

    const { code } = await signIn(realmName, 'openid offline_access');
    await unassignScope(realmId, 'offline_access');
    const redeemed = await redeemCode(realmName, code);

    expect(redeemed.scope).toBe('openid');
    const grants = await grantsForSubject(realmId, subjectId);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toBe('openid');
    expect(grants[0]?.sessionId).not.toBeNull();
  });
});
