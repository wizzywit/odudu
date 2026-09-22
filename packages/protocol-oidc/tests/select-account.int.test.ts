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
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionRealm, sessions } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

// decideReuse's 'select' outcome and renderSelectAccountPage
// (view/select-account-html.ts) both existed before this file — this is
// the first thing that reaches either from the wire. The property under
// test throughout: a posted session_id is a claim, honoured only when it
// names a member of the set this browser's own cookies resolve to, and
// only once it passes every other check an ordinary reuse would —
// max_age included.

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
// controls, for the one test that needs the parked authentication
// session's own TTL to actually elapse rather than merely be plausible.
let httpClocked: FastifyInstance;
let fakeClock: FakeClock;

const CLIENT_ID = 'select-account-client';
const REDIRECT_URI = 'https://app.example/callback';
const ALICE_USERNAME = 'alice';
const ALICE_PASSWORD = 'correct horse battery staple';
const BOB_USERNAME = 'bob';
const BOB_PASSWORD = 'a different passphrase entirely';
const CAROL_USERNAME = 'carol';
const CAROL_PASSWORD = 'yet another passphrase again';
const KEK = Buffer.alloc(32, 9);

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function setupRealm(name: string): Promise<{ realmId: string }> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    // sso_session_idle_seconds raised well past the 30-minute TTL
    // AUTH_SESSION_TTL_MS fixes for an authentication session, so the one
    // expiry test below can advance past the latter without the SSO
    // session itself going idle-expired and confounding the result.
    await tx.insert(realms).values({
      id: realmId,
      name,
      maxSessionsPerBrowser: 10,
      ssoSessionIdleSeconds: 7_200,
    });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Select-account test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    for (const [username, password] of [
      [ALICE_USERNAME, ALICE_PASSWORD],
      [BOB_USERNAME, BOB_PASSWORD],
      [CAROL_USERNAME, CAROL_PASSWORD],
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
  return { realmId };
}

async function issuerFor(realmName: string): Promise<string> {
  const res = await http.inject({
    url: `/realms/${realmName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function mintIdToken(realmName: string, sub: string): Promise<string> {
  const key = signingKeyOf.get(realmName);
  if (key === undefined) throw new Error(`no signing key for ${realmName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { iss: await issuerFor(realmName), aud: CLIENT_ID, sub, iat: now, exp: now + 300 },
    { key, kek: KEK },
  );
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

async function liveSessionIdOf(realmId: string, subjectId: string): Promise<string> {
  const rows = await owner.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.realmId, realmId), eq(sessions.subjectId, subjectId)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no live session for subject ${subjectId}`);
  return row.id;
}

// Ordered oldest first, for a subject a test signs in more than once.
async function liveSessionIdsOf(realmId: string, subjectId: string): Promise<string[]> {
  const rows = await owner.db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(eq(sessions.realmId, realmId), eq(sessions.subjectId, subjectId)));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((row) => row.id);
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

function cookieList(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

// A real browser merges each Set-Cookie's name=value pair into the Cookie
// header of its next request.
function mergeCookies(jar: Map<string, string>, res: LightMyRequestResponse): void {
  for (const set of cookieList(res)) {
    const pair = set.split(';')[0];
    const index = pair?.indexOf('=');
    if (pair === undefined || index === undefined || index === -1) continue;
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractAuthSessionId(body: string): string {
  const match = /name="auth_session_id" value="([^"]*)"/.exec(body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered page');
  return value;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

// Signs a username/password in against a fresh authorization request,
// prompt=login forcing the form even once the jar already holds a live SSO
// session for somebody else — a repeat visit that reused it would never
// submit credentials again, and callers need every login here to.
async function login(
  realmName: string,
  jar: Map<string, string>,
  username: string,
  password: string,
  instance: FastifyInstance = http,
): Promise<LightMyRequestResponse> {
  const cookie = cookieHeader(jar);
  const started = await instance.inject({
    url: authorizeUrl(realmName, { prompt: 'login' }),
    headers: cookie.length > 0 ? { cookie } : {},
  });
  if (started.statusCode !== 200) {
    throw new Error(
      `expected /authorize to render the login form, got ${String(started.statusCode)}`,
    );
  }
  const authSessionId = extractAuthSessionId(started.body);

  const form = new URLSearchParams({ auth_session_id: authSessionId, username, password });
  const res = await instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie.length > 0 ? { cookie } : {}),
    },
  });
  expect(res.statusCode).toBe(302);
  mergeCookies(jar, res);
  return res;
}

async function postSelectAccount(
  realmName: string,
  jar: Map<string, string>,
  fields: Record<string, string | undefined>,
  instance: FastifyInstance = http,
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(key, value);
  }
  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/select-account`,
    payload: params.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
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
      kek: Buffer.alloc(32, 9),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
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
      kek: Buffer.alloc(32, 9),
      clock: fakeClock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
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

describe('the account chooser', () => {
  it('shows the chooser when a browser holds two live sessions', async () => {
    const realmName = `select-two-sessions-${newId()}`;
    await setupRealm(realmName);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);

    const res = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Choose an account');
  });

  it('lists one button per subject, keeping the newest of two sessions for the same account', async () => {
    const realmName = `select-dedupe-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const alice = await subjectIdOf(realmId, ALICE_USERNAME);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);
    const [olderAliceSessionId, newerAliceSessionId] = await liveSessionIdsOf(realmId, alice);
    if (olderAliceSessionId === undefined || newerAliceSessionId === undefined) {
      throw new Error("expected two of alice's own live sessions");
    }

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'select_account' }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(newerAliceSessionId);
    expect(res.body).not.toContain(olderAliceSessionId);
    const buttons = res.body.match(/name="session_id"/g) ?? [];
    expect(buttons).toHaveLength(2);
  });

  it('[OIDC-CORE-3.1.2.1-15] shows the chooser for prompt=select_account with one live session', async () => {
    const realmName = `select-prompt-${newId()}`;
    await setupRealm(realmName);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'select_account' }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Choose an account');
  });

  // Two ids on one behaviour, the same way consent.int.test.ts's own
  // prompt=none refusal is: OIDC Core states it twice, once in §3.1.2.1's
  // own prompt=none MUST and once in §3.1.2.6's account_selection_required
  // MAY. tools/trace/src/suite.ts's lastIdIn keeps only the last bracket in
  // a title, so this is asserted twice under two titles rather than once
  // under two brackets.
  it('[OIDC-CORE-3.1.2.1-16] redirects with account_selection_required under prompt=none', async () => {
    const realmName = `select-prompt-none-${newId()}`;
    await setupRealm(realmName);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'none' }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('error')).toBe(
      'account_selection_required',
    );
  });

  it('[OIDC-CORE-3.1.2.6-08] returns account_selection_required as the prompt=none error', async () => {
    const realmName = `select-prompt-none-mayrow-${newId()}`;
    await setupRealm(realmName);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'none' }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('error')).toBe(
      'account_selection_required',
    );
  });

  it('continues the authorization with the chosen session', async () => {
    const realmName = `select-continue-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const alice = await subjectIdOf(realmId, ALICE_USERNAME);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);

    const ephemeral = jar.get(`${realmName}-session`);
    if (ephemeral === undefined) throw new Error('expected an ephemeral session cookie');
    const sessionIds = ephemeral.split('.').filter((id) => id.length > 0);
    const aliceSessionId = await liveSessionIdOf(realmId, alice);
    if (!sessionIds.includes(aliceSessionId)) {
      throw new Error('expected alice session id to be in the browser cookie');
    }

    const chooser = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: cookieHeader(jar) },
    });
    expect(chooser.statusCode).toBe(200);
    const authSessionId = extractAuthSessionId(chooser.body);

    const res = await postSelectAccount(realmName, jar, {
      auth_session_id: authSessionId,
      session_id: aliceSessionId,
    });

    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('code')).toBeTruthy();
  });

  // decideReuse's own max_age filter (session-reuse.ts's withinMaxAge) has
  // to be re-applied to the posted selection, not only to what the chooser
  // listed: a session excluded from the page for being too old is not a
  // valid choice merely because it is still live and still this browser's.
  it("refuses a chosen session older than the request required, even though it is the browser's own", async () => {
    const realmName = `select-max-age-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const bob = await subjectIdOf(realmId, BOB_USERNAME);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);

    const bobSessionId = await liveSessionIdOf(realmId, bob);
    await owner.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(sessions.id, bobSessionId));

    // max_age=60 with bob backdated 120s: decideReuse's own candidate
    // filter drops him, so the chooser — forced open by prompt=select_account
    // even though only one candidate remains — lists alice only.
    const chooser = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'select_account', max_age: '60' }),
      headers: { cookie: cookieHeader(jar) },
    });
    expect(chooser.statusCode).toBe(200);
    expect(chooser.body).not.toContain(bobSessionId);
    const authSessionId = extractAuthSessionId(chooser.body);

    const res = await postSelectAccount(realmName, jar, {
      auth_session_id: authSessionId,
      session_id: bobSessionId,
    });

    expect(res.statusCode).toBe(400);
  });

  // The parked authentication session the chooser rendered against has its
  // own 30-minute TTL (authn-flows/src/usecase/executor.ts's
  // AUTH_SESSION_TTL_MS) — the same one every sibling POST is gated by via
  // authenticatedSession. A selection posted after it has expired must be
  // refused the same way, not accepted indefinitely merely because
  // nothing here ever marks the row consumed.
  it('refuses a selection posted after the parked session has expired', async () => {
    const realmName = `select-expired-${newId()}`;
    await setupRealm(realmName);
    fakeClock.set(new Date());
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD, httpClocked);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD, httpClocked);

    const chooser = await httpClocked.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: cookieHeader(jar) },
    });
    expect(chooser.statusCode).toBe(200);
    const authSessionId = extractAuthSessionId(chooser.body);
    const aliceSessionId = /value="([^"]*)">alice/.exec(chooser.body)?.[1];
    if (aliceSessionId === undefined) throw new Error('expected alice on the chooser page');

    fakeClock.advance(31 * 60_000);

    const res = await postSelectAccount(
      realmName,
      jar,
      { auth_session_id: authSessionId, session_id: aliceSessionId },
      httpClocked,
    );

    expect(res.statusCode).toBe(400);
  });

  // The security case: honouring session_id merely because it names a live
  // session anywhere in the realm — rather than a member of the set this
  // browser's own cookies resolve to — is a complete authentication bypass.
  it('refuses a chosen session the cookie does not name', async () => {
    const realmName = `select-stranger-${newId()}`;
    const { realmId } = await setupRealm(realmName);

    // Carol signs in on a browser of her own; her session is live in the
    // realm but never reaches the jar below.
    const carolJar = new Map<string, string>();
    await login(realmName, carolJar, CAROL_USERNAME, CAROL_PASSWORD);
    const carol = await subjectIdOf(realmId, CAROL_USERNAME);
    const carolSessionId = await liveSessionIdOf(realmId, carol);

    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);
    const chooser = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: cookieHeader(jar) },
    });
    expect(chooser.statusCode).toBe(200);
    const authSessionId = extractAuthSessionId(chooser.body);

    const res = await postSelectAccount(realmName, jar, {
      auth_session_id: authSessionId,
      session_id: carolSessionId,
    });

    expect(res.statusCode).toBe(400);
  });

  it('falls through to the login form when the user asks for another account', async () => {
    const realmName = `select-use-other-${newId()}`;
    await setupRealm(realmName);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);

    const chooser = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: cookieHeader(jar) },
    });
    expect(chooser.statusCode).toBe(200);
    const authSessionId = extractAuthSessionId(chooser.body);

    const res = await postSelectAccount(realmName, jar, {
      auth_session_id: authSessionId,
      use_other: 'true',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="password"');
  });
});

describe('an id_token_hint narrows the chooser to the subject it names', () => {
  it('reuses the hinted subject rather than rendering the chooser', async () => {
    const realmName = `select-hint-reuse-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const alice = await subjectIdOf(realmId, ALICE_USERNAME);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);
    const hint = await mintIdToken(realmName, alice);

    const res = await http.inject({
      url: authorizeUrl(realmName, { id_token_hint: hint }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('code')).toBeTruthy();
  });

  it('returns a code under prompt=none instead of account_selection_required', async () => {
    const realmName = `select-hint-prompt-none-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const alice = await subjectIdOf(realmId, ALICE_USERNAME);
    const jar = new Map<string, string>();
    await login(realmName, jar, ALICE_USERNAME, ALICE_PASSWORD);
    await login(realmName, jar, BOB_USERNAME, BOB_PASSWORD);
    const hint = await mintIdToken(realmName, alice);

    const res = await http.inject({
      url: authorizeUrl(realmName, { id_token_hint: hint, prompt: 'none' }),
      headers: { cookie: cookieHeader(jar) },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBeNull();
    expect(location.searchParams.get('code')).toBeTruthy();
  });
});

describe('the chooser POST against a missing body', () => {
  // Fastify leaves request.body undefined for a POST with no Content-Type
  // and no payload — respondToSelectAccountSubmission must not throw
  // reading auth_session_id off it, and instead falls into the ordinary
  // unauthenticated handling an absent auth_session_id already gets.
  it('refuses with the unauthenticated page rather than throwing', async () => {
    const realmName = `select-empty-body-${newId()}`;
    await setupRealm(realmName);

    const res = await http.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/select-account`,
    });
    expect(res.statusCode).toBe(400);
  });
});
