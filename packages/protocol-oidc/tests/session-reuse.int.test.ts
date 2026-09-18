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
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessions, provisionRealm } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

// Two assertions matter here beyond the happy path: an authorization code
// is issued with no page rendered, and an unverified account holding a
// live cookie is refused. The second is the one no existing test covers,
// because every existing test drives the form POST.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;
let httpClockedApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
// A second instance sharing the database but backed by a clock this file
// controls, for the two tests that need to know exactly how much time has
// passed rather than merely that some real time has (max_age, auth_time).
let httpClocked: FastifyInstance;
let fakeClock: FakeClock;

const CLIENT_ID = 'session-reuse-client';
const CLIENT_SECRET = 'session-reuse-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
// A second End-User, so an id_token_hint naming one can be told from the
// other one who actually completes a forced reauthentication.
const OTHER_USERNAME = 'grace';
const OTHER_PASSWORD = 'a different passphrase entirely';
const KEK = Buffer.alloc(32, 9);

// RFC 7636 Appendix B's worked example, for the one test that redeems a
// code rather than just checking where it redirects to.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function setupRealm(name: string): Promise<string> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Session reuse test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    for (const [username, password] of [
      [USERNAME, PASSWORD],
      [OTHER_USERNAME, OTHER_PASSWORD],
    ] as const) {
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await tx.insert(users).values({ subjectId: subject.id, realmId, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        realmId,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: await hashPassword(password) },
      });
    }

    // A signing key, so an id_token_hint minted for this realm verifies
    // (OIDC Core §3.1.2.2) the way one issued by /token would.
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
  return realmId;
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

async function issuerFor(instance: FastifyInstance, realmName: string): Promise<string> {
  const res = await instance.inject({
    url: `/realms/${realmName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function mintIdToken(
  instance: FastifyInstance,
  realmName: string,
  sub: string,
): Promise<string> {
  const key = signingKeyOf.get(realmName);
  if (key === undefined) throw new Error(`no signing key for ${realmName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { iss: await issuerFor(instance, realmName), aud: CLIENT_ID, sub, iat: now, exp: now + 300 },
    { key, kek: KEK },
  );
}

function authorizeUrl(
  realmName: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/realms/${realmName}/protocol/openid-connect/auth?${query.toString()}`;
}

async function startAuthSession(
  instance: FastifyInstance,
  realmName: string,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const res = await instance.inject({ url: authorizeUrl(realmName, overrides) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
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

async function submitCredentials(
  instance: FastifyInstance,
  realmName: string,
  authSessionId: string,
  username: string,
  password: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({ auth_session_id: authSessionId, username, password });
  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// Signs USERNAME/PASSWORD in against a fresh authorization request and
// returns the SSO session cookie the login redirect set.
async function signIn(
  realmName: string,
  instance: FastifyInstance = http,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const authSessionId = await startAuthSession(instance, realmName, overrides);
  const res = await submitCredentials(instance, realmName, authSessionId, USERNAME, PASSWORD);
  expect(res.statusCode).toBe(302);
  const cookie = setCookieValue(res);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  return cookie;
}

async function redeemCode(
  instance: FastifyInstance,
  realmName: string,
  code: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
}

function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT to have a payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function sessionRowFor(
  cookie: string,
): Promise<{ createdAt: Date; lastActiveAt: Date } | undefined> {
  const sessionId = cookie.split('=')[1];
  if (sessionId === undefined) throw new Error('expected a session id in the cookie');
  const rows = await owner.db
    .select({ createdAt: sessions.createdAt, lastActiveAt: sessions.lastActiveAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return rows[0];
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
    }),
  );
  await http.ready();

  fakeClock = new FakeClock(new Date());
  httpClocked = Fastify();
  httpClockedApp = httpClocked;
  await httpClocked.register(formbody);
  await httpClocked.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clock: fakeClock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
    }),
  );
  await httpClocked.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await httpClockedApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('a live session cookie completes an authorization request', () => {
  it('redirects to redirect_uri with code and iss, with no login page rendered', async () => {
    const realmId = newId();
    const realmName = `reuse-${realmId}`;
    await setupRealm(realmName);
    const cookie = await signIn(realmName);

    const res = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('iss')).toBeTruthy();
    // No page: a redirect, not the 200 login form the first request got.
    expect(res.headers['content-type']).toBeUndefined();
  });

  it('also succeeds under prompt=none, which is the point of prompt=none', async () => {
    const realmId = newId();
    const realmName = `reuse-none-${realmId}`;
    await setupRealm(realmName);
    const cookie = await signIn(realmName);

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'none' }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('error')).toBeNull();
  });

  // OIDC Core §3.1.2.2: a live session must not let the wrong subject
  // through. Deleting the reuse path's id_token_hint mismatch check
  // (authorization-request.ts) would leave the suite green without these:
  // nothing else redeems a reuse-issued code or checks whose it was.
  it('redeems to the session subject, not the other seeded user', async () => {
    const realmName = `reuse-subject-${newId()}`;
    const realmId = await setupRealm(realmName);
    const ada = await subjectIdOf(realmId, USERNAME);
    const grace = await subjectIdOf(realmId, OTHER_USERNAME);
    const cookie = await signIn(realmName);

    const res = await http.inject({
      url: authorizeUrl(realmName, { code_challenge: CHALLENGE }),
      headers: { cookie },
    });
    const code = new URL(locationHeader(res)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the reuse redirect');

    const redeemed = await redeemCode(http, realmName, code);
    expect(redeemed.statusCode).toBe(200);
    const sub = jwtPayload(redeemed.json<{ id_token: string }>().id_token).sub;
    expect(sub).toBe(ada);
    expect(sub).not.toBe(grace);
  });

  it('refuses reuse when an id_token_hint names a different subject', async () => {
    const realmName = `reuse-hint-mismatch-${newId()}`;
    const realmId = await setupRealm(realmName);
    const grace = await subjectIdOf(realmId, OTHER_USERNAME);
    const cookie = await signIn(realmName); // a live session for ada

    const hint = await mintIdToken(http, realmName, grace);
    const res = await http.inject({
      url: authorizeUrl(realmName, { id_token_hint: hint }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('reuses when an id_token_hint names the session subject itself', async () => {
    const realmName = `reuse-hint-match-${newId()}`;
    const realmId = await setupRealm(realmName);
    const ada = await subjectIdOf(realmId, USERNAME);
    const cookie = await signIn(realmName);

    const hint = await mintIdToken(http, realmName, ada);
    const res = await http.inject({
      url: authorizeUrl(realmName, { id_token_hint: hint }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('error')).toBeNull();
  });

  it('moves last_active_at on a successful reuse', async () => {
    const realmId = newId();
    const realmName = `reuse-touch-${realmId}`;
    await setupRealm(realmName);
    const cookie = await signIn(realmName);

    const before = await sessionRowFor(cookie);
    expect(before).toBeDefined();

    // Real time must actually advance between the two reads.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const res = await http.inject({ url: authorizeUrl(realmName), headers: { cookie } });
    expect(res.statusCode).toBe(302);

    const after = await sessionRowFor(cookie);
    expect(after).toBeDefined();
    expect(after?.lastActiveAt.getTime()).toBeGreaterThan(before?.lastActiveAt.getTime() ?? 0);
  });
});

describe('the verified-email gate applies to a reused session too', () => {
  it('refuses a live cookie for an unverified subject once the realm requires verification', async () => {
    const realmName = `reuse-unverified-${newId()}`;
    const realmId = await setupRealm(realmName);
    // Signed in while verify_email is off, so the password path never
    // checked the gate — an unverified account can still hold a live
    // session, exactly the state the reuse path must not trust for free.
    const cookie = await signIn(realmName);

    await owner.db.update(realms).set({ verifyEmail: true }).where(eq(realms.id, realmId));

    const res = await http.inject({ url: authorizeUrl(realmName), headers: { cookie } });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('does not touch the session it refused to reuse for', async () => {
    const realmName = `reuse-unverified-touch-${newId()}`;
    const realmId = await setupRealm(realmName);
    const cookie = await signIn(realmName);
    await owner.db.update(realms).set({ verifyEmail: true }).where(eq(realms.id, realmId));
    const before = await sessionRowFor(cookie);

    const res = await http.inject({ url: authorizeUrl(realmName), headers: { cookie } });
    expect(res.statusCode).toBe(302);

    const after = await sessionRowFor(cookie);
    expect(after?.lastActiveAt.getTime()).toBe(before?.lastActiveAt.getTime());
  });
});

describe('a session cookie that cannot be reused', () => {
  it('starts a fresh authentication under prompt=login even with a live session', async () => {
    const realmId = newId();
    const realmName = `reuse-login-${realmId}`;
    await setupRealm(realmName);
    const cookie = await signIn(realmName);

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'login' }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('auth_session_id');
  });

  it('is ignored for an unknown or garbage cookie value', async () => {
    const realmId = newId();
    const realmName = `reuse-garbage-${realmId}`;
    await setupRealm(realmName);

    const res = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: `${realmName}-session=not-a-real-session-id` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('auth_session_id');
  });
});

// OIDC Core §3.1.2.1/§15.1: max_age decides, rather than prompt alone,
// whether a live session still counts. Both tests share one realm and one
// controllable clock so "exceeded" and "within" are exact, not timing luck.
describe('[OIDC-CORE-3.1.2.1-10] max_age decides whether a live session still counts', () => {
  it('reauthenticates when max_age is exceeded despite a live session', async () => {
    const realmName = `reuse-maxage-exceeded-${newId()}`;
    await setupRealm(realmName);
    // Sessions record their creation time from the real database clock
    // (`created_at`'s own default), not from this file's fake one — synced
    // to real time immediately before login so the two agree.
    fakeClock.set(new Date());
    const cookie = await signIn(realmName, httpClocked);

    fakeClock.advance(10_000);
    const res = await httpClocked.inject({
      url: authorizeUrl(realmName, { max_age: '5' }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('auth_session_id');
  });

  it('[OIDC-CORE-2-08] reuses within max_age, carrying the original auth_time forward', async () => {
    const realmName = `reuse-maxage-within-${newId()}`;
    await setupRealm(realmName);
    fakeClock.set(new Date());
    const cookie = await signIn(realmName, httpClocked, { code_challenge: CHALLENGE });
    // The ground truth for auth_time is the session row's own created_at
    // (real database time), not this file's fake clock.
    const authTime = (await sessionRowFor(cookie))?.createdAt;
    if (authTime === undefined) throw new Error('expected the session to exist');

    fakeClock.advance(120_000);
    const res = await httpClocked.inject({
      url: authorizeUrl(realmName, { max_age: '3600', code_challenge: CHALLENGE }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const code = new URL(locationHeader(res)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the reuse redirect');

    const redeemed = await redeemCode(httpClocked, realmName, code);
    expect(redeemed.statusCode).toBe(200);
    const idToken = redeemed.json<{ id_token: string }>().id_token;
    const payload = jwtPayload(idToken);
    // The reused session's own login moment, not the later moment of reuse
    // two minutes on — which is what makes a client's own max_age check
    // (§3.1.3.7) meaningful rather than rubber-stamped.
    expect(payload.auth_time).toBe(Math.floor(authTime.getTime() / 1000));
  });
});

// `issueAuthorizationCode`'s TTL used to be derived from `authTime`,
// which is exactly right on the form path (authTime is `now` there) and
// exactly wrong here — a session reused minutes after login got a code
// already expired by the time it was issued. No fake clock: the session's
// own `created_at` is pushed into the past through the owner connection,
// which is real database state, and only the running Postgres's own `now()`
// decides whether the code redeems (repository/codes.ts's `expires_at >
// now()`).
describe("a reused session's code expires from its own issuance, not the session's login", () => {
  it('redeems, and still carries the original auth_time, when reused minutes after login', async () => {
    const realmName = `reuse-backdated-${newId()}`;
    await setupRealm(realmName);
    const cookie = await signIn(realmName, http, { code_challenge: CHALLENGE });
    const sessionId = cookie.split('=')[1];
    if (sessionId === undefined) throw new Error('expected a session id in the cookie');

    const backdated = new Date(Date.now() - 5 * 60_000);
    await owner.db.update(sessions).set({ createdAt: backdated }).where(eq(sessions.id, sessionId));

    const res = await http.inject({
      url: authorizeUrl(realmName, { code_challenge: CHALLENGE, max_age: '3600' }),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    const code = new URL(locationHeader(res)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the reuse redirect');

    const redeemed = await redeemCode(http, realmName, code);
    expect(redeemed.statusCode).toBe(200);
    const payload = jwtPayload(redeemed.json<{ id_token: string }>().id_token);
    expect(payload.auth_time).toBe(Math.floor(backdated.getTime() / 1000));
  });
});
