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
import { sessions, provisionTenant } from '@odudu/authn-flows';
import { clientScopeAssignments, clientScopeRepository, clients } from '@odudu/domain-tenant';
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
import { tokenGrants } from '#/schema/token-grants';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

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
  tx: TenantScopedDatabase,
  clientDbId: string,
  scopeNames: readonly string[],
): Promise<void> {
  const repository = clientScopeRepository(tx);
  for (const name of scopeNames) {
    const scope = await repository.byName(name);
    if (scope === null) throw new Error(`tenant does not define scope ${name}`);
    await repository.assign(clientDbId, scope.id, 'default');
  }
}

// No repository method withdraws an assignment (none exists as of this
// task) — this is the one test that needs to, to show the resolved scope
// at redemption, not the one /authorize accepted, is the authority.
async function unassignScope(tenantId: string, scopeName: string): Promise<void> {
  await withTenant(app.db, tenantId, async (tx) => {
    const scope = await clientScopeRepository(tx).byName(scopeName);
    if (scope === null) throw new Error(`tenant does not define scope ${scopeName}`);
    await tx
      .delete(clientScopeAssignments)
      .where(eq(clientScopeAssignments.clientScopeId, scope.id));
  });
}

// Every test gets its own tenant and client, so which scopes the client is
// assigned — the one thing each test case varies — never leaks between
// them.
async function setupTenant(
  name: string,
  assignedScopes: readonly string[],
): Promise<{ tenantId: string; subjectId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  let subjectId = '';
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'offline access test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await assignScopes(tx, clientDbId, assignedScopes);
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
    subjectId = subject.id;
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
  return { tenantId, subjectId };
}

function authorizeUrl(
  tenantName: string,
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
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
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

async function redeemCode(
  tenantName: string,
  code: string,
): Promise<{ access_token: string; id_token: string; refresh_token: string; scope: string }> {
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
  return res.json<{
    access_token: string;
    id_token: string;
    refresh_token: string;
    scope: string;
  }>();
}

// Signs USERNAME/PASSWORD in against a fresh authorization request and
// returns the cookie and code the login redirect carried, stopping short of
// redemption — the one test in this file that withdraws a scope assignment
// between the two needs that seam.
async function signIn(
  tenantName: string,
  scope: string,
): Promise<{ cookie: string; code: string }> {
  const authorize = await http.inject({ url: authorizeUrl(tenantName, scope) });
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

  return { cookie, code };
}

// Signs in and redeems in one step, for every test that has no reason to
// pause in between.
async function completeFlow(
  tenantName: string,
  scope: string,
): Promise<{ sessionEntry: string; access_token: string; refresh_token: string; scope: string }> {
  const { cookie, code } = await signIn(tenantName, scope);
  const sessionEntry = cookie.split('=')[1];
  if (sessionEntry === undefined) throw new Error('expected a session entry in the cookie');
  const redeemed = await redeemCode(tenantName, code);
  return { sessionEntry, ...redeemed };
}

// A live session cookie completes a second authorization request with no
// login page rendered — this is how one browser session ends up owning
// both a session-bound grant and an offline one.
async function reuseSession(
  tenantName: string,
  cookie: string,
  scope: string,
): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const res = await http.inject({ url: authorizeUrl(tenantName, scope), headers: { cookie } });
  if (res.statusCode !== 302) {
    throw new Error(`expected the live session to reuse, got ${String(res.statusCode)}`);
  }
  const code = new URL(locationHeader(res)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the reused-session redirect');
  return redeemCode(tenantName, code);
}

async function grantsForSubject(
  tenantId: string,
  subjectId: string,
): Promise<{ sessionId: string | null; scope: string }[]> {
  return withTenant(app.db, tenantId, (tx) =>
    tx
      .select({ sessionId: tokenGrants.sessionId, scope: tokenGrants.scope })
      .from(tokenGrants)
      .where(eq(tokenGrants.subjectId, subjectId)),
  );
}

// Thrown rather than returned so the tests can assert with
// `.rejects.toMatchObject({ error: ... })` — `error` is a real property of
// the thrown value, not just folded into the message, so that assertion
// reads the token endpoint's own error code, not a string it was baked into.
class TokenEndpointError extends Error {
  readonly error: string;

  constructor(body: { error: string }) {
    super(`token endpoint refused: ${JSON.stringify(body)}`);
    this.error = body.error;
  }
}

async function refresh(
  tenantName: string,
  refreshToken: string,
): Promise<{ token_type: string; access_token: string }> {
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
    throw new TokenEndpointError(res.json<{ error: string }>());
  }
  return res.json<{ token_type: string; access_token: string }>();
}

async function logoutViaConfirmation(tenantName: string, cookie: string): Promise<void> {
  const res = await http.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/logout`,
    headers: { cookie },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected the confirmation page, got ${String(res.statusCode)}`);
  }
  const match = /name="session_id" value="([^"]*)"/.exec(res.body);
  const confirmedSessionId = match?.[1];
  const csrf = /name="csrf" value="([^"]*)"/.exec(res.body)?.[1];
  if (confirmedSessionId === undefined || csrf === undefined) {
    throw new Error('session_id or csrf not found in the confirmation form');
  }
  const form = new URLSearchParams({ session_id: confirmedSessionId, csrf });
  const confirmed = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/logout`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
  if (confirmed.statusCode !== 200) {
    throw new Error(
      `expected the logout confirmation to succeed, got ${String(confirmed.statusCode)}`,
    );
  }
}

// No fake clock: `liveById` evaluates `isSessionLive` against whatever
// `now` the caller hands it (the real system clock here, since this file
// runs no `httpClocked` instance), so advancing time would mean actually
// waiting out the tenant's idle window. Moving `last_active_at` into the
// past through the owner connection instead is instant, the same way
// session-reuse.int.test.ts back-dates `created_at` for `max_age`.
async function idleOutEverySession(tenantId: string): Promise<void> {
  await owner.db
    .update(sessions)
    .set({ lastActiveAt: new Date(Date.now() - 100_000_000) })
    .where(eq(sessions.tenantId, tenantId));
}

async function lastActiveAtOf(sessionId: string): Promise<Date> {
  const rows = await owner.db
    .select({ lastActiveAt: sessions.lastActiveAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  const row = rows[0];
  if (row === undefined) throw new Error(`no session row for ${sessionId}`);
  return row.lastActiveAt;
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

describe('offline access', () => {
  it('issues a grant with no session when offline_access is requested and assigned', async () => {
    const tenantName = `offline-issue-${newId()}`;
    const { tenantId, subjectId } = await setupTenant(tenantName, ['openid', 'offline_access']);

    await completeFlow(tenantName, 'openid offline_access');

    const grants = await grantsForSubject(tenantId, subjectId);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.sessionId).toBeNull();
  });

  it('[OIDC-BACKCHANNEL-2.7-02] leaves the offline grant refreshable after the session is logged out', async () => {
    const tenantName = `offline-logout-${newId()}`;
    await setupTenant(tenantName, ['openid', 'offline_access']);

    const first = await completeFlow(tenantName, 'openid');
    const cookie = `${tenantName}-session=${first.sessionEntry}`;
    const offline = await reuseSession(tenantName, cookie, 'openid offline_access');

    await logoutViaConfirmation(tenantName, cookie);

    await expect(refresh(tenantName, first.refresh_token)).rejects.toMatchObject({
      error: 'invalid_grant',
    });
    await expect(refresh(tenantName, offline.refresh_token)).resolves.toMatchObject({
      token_type: 'Bearer',
    });
  });

  it('leaves the offline grant refreshable after the session idles out', async () => {
    const tenantName = `offline-idle-${newId()}`;
    const { tenantId } = await setupTenant(tenantName, ['openid', 'offline_access']);

    const { refresh_token: offlineRefreshToken } = await completeFlow(
      tenantName,
      'openid offline_access',
    );
    await idleOutEverySession(tenantId);

    await expect(refresh(tenantName, offlineRefreshToken)).resolves.toMatchObject({
      token_type: 'Bearer',
    });
  });

  it('refuses a session-bound refresh once the session is no longer live', async () => {
    const tenantName = `offline-session-dead-${newId()}`;
    const { tenantId } = await setupTenant(tenantName, ['openid']);

    const { refresh_token: refreshToken } = await completeFlow(tenantName, 'openid');
    await idleOutEverySession(tenantId);

    await expect(refresh(tenantName, refreshToken)).rejects.toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('touches the session on a successful session-bound refresh', async () => {
    // §3.1's rule, and the reason a client refreshing every five minutes
    // keeps a session alive rather than idling out from underneath it —
    // untested, this line in refresh-rotation.ts could be deleted and the
    // rest of the suite would stay green.
    const tenantName = `offline-touch-${newId()}`;
    await setupTenant(tenantName, ['openid']);
    const { sessionEntry, refresh_token: refreshToken } = await completeFlow(tenantName, 'openid');
    const sessionId = sessionEntry.split(':')[0] ?? '';

    // Back-dated so the two reads cannot tie on timer resolution alone,
    // and still well inside the default idle window so the refresh itself
    // succeeds.
    await owner.db
      .update(sessions)
      .set({ lastActiveAt: new Date(Date.now() - 5_000) })
      .where(eq(sessions.id, sessionId));
    const before = await lastActiveAtOf(sessionId);

    await refresh(tenantName, refreshToken);

    const after = await lastActiveAtOf(sessionId);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('does not issue an offline grant when the assignment is withdrawn before the code is redeemed', async () => {
    // Assigned when /authorize accepts the request, withdrawn before the
    // code is redeemed — resolveScope at redemption is what must refuse
    // it, not /authorize's own upfront check, which would refuse the whole
    // request rather than narrowing it (tenant-scopes.int.test.ts covers
    // that upfront refusal already).
    const tenantName = `offline-unassigned-${newId()}`;
    const { tenantId, subjectId } = await setupTenant(tenantName, ['openid', 'offline_access']);

    const { code } = await signIn(tenantName, 'openid offline_access');
    await unassignScope(tenantId, 'offline_access');
    const redeemed = await redeemCode(tenantName, code);

    expect(redeemed.scope).toBe('openid');
    const grants = await grantsForSubject(tenantId, subjectId);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toBe('openid');
    expect(grants[0]?.sessionId).not.toBeNull();
  });

  // The hole `decideLogout`'s sid-only comparison (logout.ts) exists to
  // close: a *current*, validly signed offline-grant ID token has no sid,
  // so before this task it would have matched the current session by
  // subject alone and skipped RP-Initiated Logout 1.0 §2's confirmation —
  // exactly the case a stale-but-valid hint from the same user must not
  // be able to exploit. logout.int.test.ts's own hints all carry a sid or
  // a foreign subject, neither of which reaches this branch.
  it('shows the confirmation page for a current offline-grant ID token naming the live session subject', async () => {
    const tenantName = `offline-hint-${newId()}`;
    await setupTenant(tenantName, ['openid', 'offline_access']);

    const { cookie, code } = await signIn(tenantName, 'openid offline_access');
    const { id_token: idToken } = await redeemCode(tenantName, code);

    const query = new URLSearchParams({ id_token_hint: idToken });
    const res = await http.inject({
      url: `/tenants/${tenantName}/protocol/openid-connect/logout?${query.toString()}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(res.body).toContain('<form');
  });
});
