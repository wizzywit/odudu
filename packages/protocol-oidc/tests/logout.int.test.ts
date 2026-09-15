import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
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
import { sessionRepository, sessions } from '@odudu/authn-flows';
import { clients, provisionClientDefaults, provisionRealmDefaults } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
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

const CLIENT_ID = 'logout-client';
const CLIENT_SECRET = 'logout-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const POST_LOGOUT_REDIRECT_URI = 'https://app.example/after-logout';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 11);

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function setupRealm(name: string): Promise<{ realmId: string; clientDbId: string }> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealmDefaults(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Logout test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      postLogoutRedirectUris: [POST_LOGOUT_REDIRECT_URI],
    });

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
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
    signingKeyOf.set(name, key);
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
  return { realmId, clientDbId };
}

async function subjectIdOf(realmId: string, username: string): Promise<string> {
  const rows = await owner.db
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(and(eq(users.realmId, realmId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in realm ${realmId}`);
  return row.subjectId;
}

async function issuerFor(realmName: string): Promise<string> {
  const res = await http.inject({
    url: `/realms/${realmName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function mintIdToken(realmName: string, sub: string, sid?: string): Promise<string> {
  const key = signingKeyOf.get(realmName);
  if (key === undefined) throw new Error(`no signing key for ${realmName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: await issuerFor(realmName),
      aud: CLIENT_ID,
      sub,
      iat: now,
      exp: now + 300,
      ...(sid !== undefined ? { sid } : {}),
    },
    { key, kek: KEK },
  );
}

function authorizeUrl(realmName: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
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

async function signIn(realmName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(realmName) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found');

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
  return cookie;
}

async function redeemCode(realmName: string, code: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  return http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
}

async function refreshWith(
  realmName: string,
  refreshToken: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
}

function sessionIdFromCookie(cookie: string): string {
  const id = cookie.split('=')[1];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

async function sessionRowFor(
  sessionId: string,
): Promise<{ expiresAt: Date; lastActiveAt: Date } | undefined> {
  const rows = await owner.db
    .select({ expiresAt: sessions.expiresAt, lastActiveAt: sessions.lastActiveAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return rows[0];
}

function logoutUrl(realmName: string, overrides: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = { ...overrides };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const suffix = query.toString();
  return `/realms/${realmName}/protocol/openid-connect/logout${suffix === '' ? '' : `?${suffix}`}`;
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

describe('GET the logout endpoint with a hint matching the session', () => {
  it('ends the session, revokes its grants, redirects, and leaves an offline grant alone', async () => {
    const realmName = `logout-${newId()}`;
    const { realmId, clientDbId } = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const hint = await mintIdToken(realmName, subjectId);

    // A real session-bound grant, from the same reused-session redirect the
    // second test in this file redeems — so "every grant of this session
    // carries revoked_at" has a grant to actually be about.
    const authorized = await http.inject({ url: authorizeUrl(realmName), headers: { cookie } });
    expect(authorized.statusCode).toBe(302);
    const code = new URL(locationHeader(authorized)).searchParams.get('code');
    if (code === null) throw new Error('expected a code from the reused-session redirect');
    const redeemed = await redeemCode(realmName, code);
    expect(redeemed.statusCode).toBe(200);

    // An offline grant for the same subject — no session — seeded directly,
    // the way the `offline_access` scope will, so this test does not wait
    // on it.
    const offlineGrant = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).create({
        realmId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid offline_access',
        audience: [],
        sessionId: null,
      }),
    );

    const res = await http.inject({
      url: logoutUrl(realmName, {
        id_token_hint: hint,
        client_id: CLIENT_ID,
        post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI,
        state: 'logout-state',
      }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(POST_LOGOUT_REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('logout-state');
    expect(res.headers['cache-control']).toBe('no-store');
    // The cookie is cleared on any outcome that actually ended a session —
    // same name and attributes login sets it with, Max-Age=0 to delete it.
    const clearedCookie = res.headers['set-cookie'];
    expect(clearedCookie).toContain(`${realmName}-session=`);
    expect(clearedCookie).toContain('Max-Age=0');

    const row = await sessionRowFor(sessionId);
    expect(row).toBeDefined();
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());

    const sessionGrants = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).bySession(sessionId),
    );
    expect(sessionGrants.length).toBeGreaterThan(0);
    expect(sessionGrants.every((grant) => grant.revokedAt !== null)).toBe(true);

    const untouchedOffline = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).byId(offlineGrant.id),
    );
    expect(untouchedOffline?.revokedAt).toBeNull();
  });

  it('refuses a redemption of a session-bound refresh token after logout, with invalid_grant', async () => {
    const realmName = `logout-refresh-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const hint = await mintIdToken(realmName, subjectId);

    const authorized = await http.inject({ url: authorizeUrl(realmName), headers: { cookie } });
    expect(authorized.statusCode).toBe(302);
    const code = new URL(locationHeader(authorized)).searchParams.get('code');
    if (code === null) throw new Error('expected a code from the reused-session redirect');

    const tokenRes = await redeemCode(realmName, code);
    expect(tokenRes.statusCode).toBe(200);
    const refreshToken = tokenRes.json<{ refresh_token: string }>().refresh_token;

    const logoutRes = await http.inject({
      url: logoutUrl(realmName, { id_token_hint: hint }),
      headers: { cookie },
    });
    // No post_logout_redirect_uri requested: ends the session with nothing
    // to redirect to, which is a 200 page rather than a 302 — and a
    // distinct page from the redirect-refused one below: it must not claim
    // a return address was refused when none was ever given.
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.body).toContain('<title>Signed out</title>');
    expect(logoutRes.body).toContain('You have been signed out.</p>');

    const refreshed = await refreshWith(realmName, refreshToken);
    expect(refreshed.statusCode).toBe(400);
    expect(refreshed.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('[OIDC-RPINITIATED-3-01] still ends the session but refuses a non-matching post_logout_redirect_uri', async () => {
    const realmName = `logout-badredirect-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const hint = await mintIdToken(realmName, subjectId);

    const res = await http.inject({
      url: logoutUrl(realmName, {
        id_token_hint: hint,
        client_id: CLIENT_ID,
        post_logout_redirect_uri: 'https://evil.example/after-logout',
      }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(400);
    // The ended-versus-not-ended pair pinned precisely: this page must say
    // the session ended (unlike the CSRF-mismatch page below, which must
    // not), and must not read like the plain logged-out page above.
    expect(res.body).toContain('<title>Signed out</title>');
    expect(res.body).toContain('the address given to return to afterward');

    const row = await sessionRowFor(sessionId);
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('[OIDC-RPINITIATED-2-01] the confirmation page is asked for on both triggers', () => {
  it('when there is no id_token_hint, and ends nothing until the form is posted', async () => {
    const realmName = `logout-confirm-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    const res = await http.inject({ url: logoutUrl(realmName), headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(res.body).toContain('<form');
    expect(res.body).toContain(sessionId);
    expect(res.headers['cache-control']).toBe('no-store');

    const stillLive = await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).liveById(sessionId, 30 * 24 * 3600, new Date()),
    );
    expect(stillLive).not.toBeNull();

    const sessionIdMatch = /name="session_id" value="([^"]*)"/.exec(res.body);
    const confirmedSessionId = sessionIdMatch?.[1];
    if (confirmedSessionId === undefined)
      throw new Error('session_id not found in confirmation form');

    const form = new URLSearchParams({ session_id: confirmedSessionId });
    const confirmed = await http.inject({
      method: 'POST',
      url: `/realms/${realmName}/protocol/openid-connect/logout`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    });
    expect(confirmed.statusCode).toBe(200);

    const row = await sessionRowFor(sessionId);
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('when the hint names somebody other than the current session', async () => {
    const realmName = `logout-mismatch-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    // A syntactically valid hint for this realm, naming a subject who is
    // not the one this cookie's session belongs to — subjectOfIdTokenHint
    // only asks whether this realm issued it, never whether the subject
    // exists, so a fabricated-but-signed subject exercises the mismatch
    // without a second user fixture.
    const hint = await mintIdToken(realmName, newId());

    const res = await http.inject({
      url: logoutUrl(realmName, { id_token_hint: hint }),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(res.body).toContain('<form');

    const stillLive = await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).liveById(sessionId, 30 * 24 * 3600, new Date()),
    );
    expect(stillLive).not.toBeNull();
  });

  it('when the hint carries a sid for a different, already-ended session', async () => {
    // The previous task put `sid` in every ID token; a hint from an
    // earlier session in the same browser, by the same subject, must not
    // skip confirmation just because the subject still matches.
    const realmName = `logout-stale-sid-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const firstCookie = await signIn(realmName);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const staleHint = await mintIdToken(realmName, subjectId, sessionIdFromCookie(firstCookie));

    // End the first session, then sign in again — a second, distinct
    // session for the same subject, in the same browser.
    await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).end(sessionIdFromCookie(firstCookie), new Date()),
    );
    const secondCookie = await signIn(realmName);
    const secondSessionId = sessionIdFromCookie(secondCookie);

    const res = await http.inject({
      url: logoutUrl(realmName, { id_token_hint: staleHint }),
      headers: { cookie: secondCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(res.body).toContain('<form');

    const stillLive = await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).liveById(secondSessionId, 30 * 24 * 3600, new Date()),
    );
    expect(stillLive).not.toBeNull();
  });
});

describe('GET the logout endpoint with a foreign realm session id', () => {
  it('ends nothing', async () => {
    const realmAName = `logout-foreign-a-${newId()}`;
    await setupRealm(realmAName);
    const cookieA = await signIn(realmAName);
    const sessionIdA = sessionIdFromCookie(cookieA);

    const realmBName = `logout-foreign-b-${newId()}`;
    await setupRealm(realmBName);

    // Realm B's cookie name is distinct, but nothing stops a raw request
    // from carrying realm A's session id under realm B's cookie name — the
    // scoping has to come from the lookup, not the header's own shape.
    const res = await http.inject({
      url: logoutUrl(realmBName),
      headers: { cookie: `${realmBName}-session=${sessionIdA}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Already signed out</title>');

    const row = await sessionRowFor(sessionIdA);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('the confirmation POST is a double-submit-cookie check', () => {
  it("refuses a session_id that is not the cookie's own session, and leaves it live", async () => {
    const realmName = `logout-csrf-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    // A syntactically plausible session id that is not the one the cookie
    // resolves to — what a forged cross-site POST would have to guess,
    // since it cannot read the HttpOnly cookie's own value.
    const form = new URLSearchParams({ session_id: newId() });
    const res = await http.inject({
      method: 'POST',
      url: `/realms/${realmName}/protocol/openid-connect/logout`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("<title>Can't sign out</title>");
    expect(res.headers['set-cookie']).toBeUndefined();

    const stillLive = await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).liveById(sessionId, 30 * 24 * 3600, new Date()),
    );
    expect(stillLive).not.toBeNull();
  });

  it('refuses a POST with no session_id field at all', async () => {
    const realmName = `logout-csrf-missing-${newId()}`;
    await setupRealm(realmName);
    const cookie = await signIn(realmName);

    const res = await http.inject({
      method: 'POST',
      url: `/realms/${realmName}/protocol/openid-connect/logout`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("<title>Can't sign out</title>");
  });
});

describe('[ODUDU-LOGOUT-NOSESSION-REDIRECT-01] a matched redirect is honoured even with no session to end', () => {
  it('redirects rather than showing the no-session page', async () => {
    const realmName = `logout-nosession-${newId()}`;
    await setupRealm(realmName);

    const res = await http.inject({
      url: logoutUrl(realmName, {
        client_id: CLIENT_ID,
        post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI,
        state: 'no-session-state',
      }),
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(POST_LOGOUT_REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('no-session-state');
  });

  it('still shows the no-session page when the requested uri is not registered', async () => {
    const realmName = `logout-nosession-badredirect-${newId()}`;
    await setupRealm(realmName);

    const res = await http.inject({
      url: logoutUrl(realmName, {
        client_id: CLIENT_ID,
        post_logout_redirect_uri: 'https://evil.example/after-logout',
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Already signed out</title>');
  });
});
