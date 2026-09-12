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
import { expectRealmIsolation } from '@odudu/db/testing';
import { clients } from '@odudu/domain-realm';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { authorizationCodeRepository } from '#/repository/codes';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodes } from '#/schema/authorization-codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;
let httpTlsApp: FastifyInstance | undefined;
let httpExpiryApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let httpTls: FastifyInstance;
let httpExpiry: FastifyInstance;
let expiryClock: FakeClock;

const CLIENT_ID = 'login-adversarial-client';
const CLIENT_SECRET = 'login-adversarial-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
// A second End-User in every realm, so "the End-User who authenticated" can
// be told apart from "some other End-User of the same realm".
const OTHER_USERNAME = 'grace';
const OTHER_PASSWORD = 'a different passphrase entirely';
const KEK = Buffer.alloc(32, 7);

// RFC 7636 Appendix B's worked example: the pair a code issued under
// CHALLENGE has to be redeemed with, for the tests that carry a journey all
// the way through to tokens.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let REALM: string;
let REALM_BETA: string;

async function buildHttp(deps: {
  database: DatabaseHandle;
  tls?: boolean;
  clock?: FakeClock;
}): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(formbody);
  await instance.register(
    oidcRoutes({
      database: deps.database,
      ownerDatabase: owner,
      kek: KEK,
      ...(deps.tls !== undefined ? { tls: deps.tls } : {}),
      ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
    }),
  );
  await instance.ready();
  return instance;
}

async function setupLoginRealm(name: string): Promise<string> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Login adversarial client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
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
        secretData: await hashPassword(password),
      });
    }

    // Every realm gets a signing key: an id_token_hint is only a hint this
    // server issued if one of these keys signed it (OIDC Core §3.1.2.2).
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
  return name;
}

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function subjectIdOf(realmName: string, username: string = USERNAME): Promise<string> {
  const realmId = await realmIdByName(realmName);
  if (realmId === undefined) throw new Error(`no realm ${realmName}`);
  const rows = await owner.db
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(and(eq(users.realmId, realmId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in ${realmName}`);
  return row.subjectId;
}

// An ID Token of the shape /token issues, signed by the realm's own key.
async function mintIdToken(realmName: string, sub: string): Promise<string> {
  const key = signingKeyOf.get(realmName);
  if (key === undefined) throw new Error(`no signing key for ${realmName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: await issuerFor(http, realmName),
      aud: CLIENT_ID,
      sub,
      iat: now,
      exp: now + 300,
    },
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
    state: 'xyz 123',
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
  if (value === undefined) {
    throw new Error('auth_session_id not found in the rendered login form');
  }
  return value;
}

interface SubmitLoginOptions {
  instance?: FastifyInstance;
  realmName?: string;
  username?: string;
  password?: string;
  // undefined: mint a fresh, live auth_session_id via /authorize.
  // null: omit the auth_session_id field entirely.
  // string: use this exact value (a foreign or fabricated session id).
  csrf?: string | null;
  extra?: Record<string, string>;
  // Parameters for the /authorize request that parks the request this
  // submission completes — an id_token_hint, say, which the form itself has
  // no field for and could not be trusted to carry if it did.
  authorize?: Record<string, string | undefined>;
  // A Cookie header to send with the submission — an SSO session already
  // established for some other End-User, which must not decide who this
  // submission is about.
  cookie?: string;
}

async function submitLogin(opts: SubmitLoginOptions): Promise<LightMyRequestResponse> {
  const instance = opts.instance ?? http;
  const realmName = opts.realmName ?? REALM;
  const authSessionId =
    opts.csrf === undefined
      ? await startAuthSession(instance, realmName, opts.authorize ?? {})
      : opts.csrf;

  const form = new URLSearchParams();
  if (authSessionId !== null) form.set('auth_session_id', authSessionId);
  if (opts.username !== undefined) form.set('username', opts.username);
  if (opts.password !== undefined) form.set('password', opts.password);
  for (const [key, value] of Object.entries(opts.extra ?? {})) form.set(key, value);

  return instance.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(opts.cookie !== undefined ? { cookie: opts.cookie } : {}),
    },
  });
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

async function issuerFor(instance: FastifyInstance, realmName: string): Promise<string> {
  const res = await instance.inject({
    url: `/realms/${realmName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function scopeOfIssuedCode(code: string): Promise<string | undefined> {
  const rows = await owner.db
    .select({ scope: authorizationCodes.scope })
    .from(authorizationCodes)
    .where(eq(authorizationCodes.codeHash, hashAuthorizationCode(code)));
  return rows[0]?.scope;
}

async function timingOfIssuedCode(
  code: string,
): Promise<{ authTime: Date; expiresAt: Date } | undefined> {
  const rows = await owner.db
    .select({ authTime: authorizationCodes.authTime, expiresAt: authorizationCodes.expiresAt })
    .from(authorizationCodes)
    .where(eq(authorizationCodes.codeHash, hashAuthorizationCode(code)));
  return rows[0];
}

async function realmIdByName(name: string): Promise<string | undefined> {
  const rows = await owner.db.select({ id: realms.id }).from(realms).where(eq(realms.name, name));
  return rows[0]?.id;
}

async function countAuthorizationCodes(realmName: string): Promise<number> {
  const realmId = await realmIdByName(realmName);
  if (realmId === undefined) return 0;
  const rows = await owner.db
    .select({ codeHash: authorizationCodes.codeHash })
    .from(authorizationCodes)
    .where(eq(authorizationCodes.realmId, realmId));
  return rows.length;
}

const GOOD = { username: USERNAME, password: PASSWORD };
const OTHER_USER = { username: OTHER_USERNAME, password: OTHER_PASSWORD };

// Carries a completed journey the rest of the way: redeem the code the
// login redirect delivered, at the realm's own Token Endpoint, as the
// client the request named.
interface TokenResponseBody {
  access_token?: string;
  id_token?: string;
  token_type?: string;
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

function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT to have a payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function subjectOf(token: string): unknown {
  return jwtPayload(token).sub;
}

// One whole journey — park the request, sign somebody in, redeem what comes
// back — reduced to the two facts the tokens carry about who it was for.
async function signInAndRedeem(
  realmName: string,
  credentials: { username: string; password: string },
  opts: { cookie?: string } = {},
): Promise<{ code: string; cookie: string | undefined; tokens: TokenResponseBody }> {
  const res = await submitLogin({
    ...credentials,
    realmName,
    authorize: { code_challenge: CHALLENGE },
    ...(opts.cookie !== undefined ? { cookie: opts.cookie } : {}),
  });
  expect(res.statusCode).toBe(302);
  const code = new URL(locationHeader(res)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const redeemed = await redeemCode(realmName, code);
  expect(redeemed.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  return {
    code,
    cookie: typeof setCookie === 'string' ? (setCookie.split(';')[0] ?? undefined) : undefined,
    tokens: redeemed.json<TokenResponseBody>(),
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

  REALM = await setupLoginRealm(`acme-${newId()}`);
  REALM_BETA = await setupLoginRealm(`beta-${newId()}`);

  http = await buildHttp({ database: app, tls: false });
  httpApp = http;
  httpTls = await buildHttp({ database: app, tls: true });
  httpTlsApp = httpTls;

  expiryClock = new FakeClock(new Date());
  httpExpiry = await buildHttp({ database: app, tls: false, clock: expiryClock });
  httpExpiryApp = httpExpiry;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await httpTlsApp?.close();
  await httpExpiryApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[OIDC-CORE-3.1.2.5-01] a successful login produces a code and a redirect', () => {
  it('redirects to the registered redirect_uri with code, state and iss', async () => {
    const realmName = await setupLoginRealm(`acme-success-${newId()}`);
    const res = await submitLogin({ ...GOOD, realmName });
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe('https://app.example/callback');
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('xyz 123');
    expect(location.searchParams.get('iss')).toBe(await issuerFor(http, realmName));
  });

  it('never puts the raw code in the database', async () => {
    const realmName = await setupLoginRealm(`acme-rawcode-${newId()}`);
    const res = await submitLogin({ ...GOOD, realmName });
    const code = new URL(locationHeader(res)).searchParams.get('code');
    expect(code).toBeTruthy();

    const realmId = await realmIdByName(realmName);
    if (realmId === undefined) throw new Error('expected the realm just created to exist');

    const rows = await owner.db
      .select({ codeHash: authorizationCodes.codeHash })
      .from(authorizationCodes)
      .where(eq(authorizationCodes.realmId, realmId));

    expect(rows.map((r) => r.codeHash)).not.toContain(code);
    expect(rows).toHaveLength(1);
  });
});

describe('[RFC6749-4.1.2-03] a granted authorization code expires shortly after issuance', () => {
  it('stores an expires_at exactly 60 seconds after auth_time', async () => {
    const realmName = await setupLoginRealm(`acme-expiry-${newId()}`);
    const res = await submitLogin({ ...GOOD, realmName });
    const code = new URL(locationHeader(res)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the redirect');

    const timing = await timingOfIssuedCode(code);
    if (timing === undefined) throw new Error('expected the issued code to be stored');
    // auth_time and expires_at both derive from the one clock read that
    // issues the code, so the TTL is exact, not merely close: a second
    // clock read straddling a millisecond boundary would show up here.
    const ttlMs = timing.expiresAt.getTime() - timing.authTime.getTime();
    expect(ttlMs).toBe(60_000);
  });
});

// OIDC Core §15.1 makes returning `auth_time` when it is requested mandatory
// for every OP. The specification defines two ways to request it — `max_age`
// (§3.1.2.1) and an Essential Claim in the `claims` parameter (§5.5) — and
// Odudu honours neither as a request: it emits `auth_time` in every ID Token
// it issues, so both requests are answered by a superset of what they asked
// for. See the reading note "§15.1's `auth_time`, answered unconditionally".
//
// The value is checked against the stored `auth_time` of the code the login
// actually issued, not merely for presence: a claim carrying the token's own
// issuance time, or milliseconds, would be a different claim wearing the
// right name.
describe('[OIDC-CORE-15.1-05] auth_time comes back whichever way a client asks for it', () => {
  const ESSENTIAL_AUTH_TIME = JSON.stringify({ id_token: { auth_time: { essential: true } } });

  it.each([
    { name: 'max_age', authorize: { max_age: '300' } },
    { name: 'an essential claims request', authorize: { claims: ESSENTIAL_AUTH_TIME } },
  ])(
    'returns the End-User’s authentication time for a request carrying $name',
    async ({ authorize }) => {
      const realmName = await setupLoginRealm(`acme-authtime-${newId()}`);
      const res = await submitLogin({
        ...GOOD,
        realmName,
        authorize: { ...authorize, code_challenge: CHALLENGE },
      });
      expect(res.statusCode).toBe(302);
      const code = new URL(locationHeader(res)).searchParams.get('code');
      if (code === null) throw new Error('expected a code on the redirect');

      const timing = await timingOfIssuedCode(code);
      if (timing === undefined) throw new Error('expected the issued code to be stored');

      const redeemed = await redeemCode(realmName, code);
      expect(redeemed.statusCode).toBe(200);
      const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
      if (idToken === undefined) throw new Error('expected an id_token');

      const authTime = jwtPayload(idToken).auth_time;
      expect(typeof authTime).toBe('number');
      expect(authTime).toBe(Math.floor(timing.authTime.getTime() / 1000));
    },
  );
});

describe('[RFC9207-2-01] the iss parameter equals the discovery issuer exactly', () => {
  it('matches the realm discovery document issuer', async () => {
    const realmName = await setupLoginRealm(`acme-iss-${newId()}`);
    const doc = (
      await http.inject({ url: `/realms/${realmName}/.well-known/openid-configuration` })
    ).json<{ issuer: string }>();
    const res = await submitLogin({ ...GOOD, realmName });
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('iss')).toBe(doc.issuer);
  });
});

describe('[OIDC-CORE-3.1.2.1-05] the login form cannot be driven cross-site', () => {
  it('rejects a submission with no CSRF token', async () => {
    expect((await submitLogin({ ...GOOD, csrf: null })).statusCode).toBe(400);
  });

  it("rejects a submission carrying another session's CSRF token", async () => {
    const foreignSessionId = await startAuthSession(http, REALM_BETA);
    expect((await submitLogin({ ...GOOD, csrf: foreignSessionId })).statusCode).toBe(400);
  });
});

describe('the parked request is what binds the code', () => {
  it('ignores scope and redirect_uri resubmitted with the form', async () => {
    const res = await submitLogin({
      ...GOOD,
      extra: { scope: 'openid admin', redirect_uri: 'https://evil.example/cb' },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin).toBe('https://app.example');

    const code = location.searchParams.get('code');
    if (code === null) throw new Error('expected a code on the redirect');
    expect(await scopeOfIssuedCode(code)).toBe('openid');
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, SameSite and Path-scoped', async () => {
    const res = await submitLogin(GOOD);
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('carries Secure and the __Host- prefix only when TLS is on', async () => {
    const tlsRes = await submitLogin({ ...GOOD, instance: httpTls });
    const tlsCookie = tlsRes.headers['set-cookie'] as string;
    expect(tlsCookie).toMatch(new RegExp(`^__Host-${REALM}-session=.*Secure`));

    const plainRes = await submitLogin(GOOD);
    const plainCookie = plainRes.headers['set-cookie'] as string;
    expect(plainCookie).not.toMatch(/Secure/);
    expect(plainCookie).toMatch(/HttpOnly/i);
  });
});

describe('failed and abandoned logins', () => {
  it('re-challenges on a wrong password without issuing a code', async () => {
    const realmName = await setupLoginRealm(`acme-wrongpw-${newId()}`);
    const res = await submitLogin({ ...GOOD, password: 'wrong', realmName });
    expect(res.statusCode).toBe(200);
    expect(await countAuthorizationCodes(realmName)).toBe(0);
  });

  it('fails an expired authentication session without issuing a code', async () => {
    const realmName = await setupLoginRealm(`acme-expired-${newId()}`);
    const authSessionId = await startAuthSession(httpExpiry, realmName);
    expiryClock.advance(31 * 60_000);

    const res = await submitLogin({
      ...GOOD,
      instance: httpExpiry,
      realmName,
      csrf: authSessionId,
    });
    expect(res.statusCode).toBe(400);
    expect(await countAuthorizationCodes(realmName)).toBe(0);
  });
});

describe('the authentication session is single-use', () => {
  it('rejects a second submission of the same auth_session_id and issues no second code', async () => {
    const realmName = await setupLoginRealm(`acme-reuse-${newId()}`);
    const authSessionId = await startAuthSession(http, realmName);

    const first = await submitLogin({ ...GOOD, realmName, csrf: authSessionId });
    expect(first.statusCode).toBe(302);
    expect(await countAuthorizationCodes(realmName)).toBe(1);

    const second = await submitLogin({ ...GOOD, realmName, csrf: authSessionId });
    expect(second.statusCode).toBe(400);
    expect(await countAuthorizationCodes(realmName)).toBe(1);
  });

  it('produces exactly one code from two concurrent submissions of the same auth_session_id', async () => {
    const realmName = await setupLoginRealm(`acme-race-${newId()}`);
    const authSessionId = await startAuthSession(http, realmName);

    const [first, second] = await Promise.all([
      submitLogin({ ...GOOD, realmName, csrf: authSessionId }),
      submitLogin({ ...GOOD, realmName, csrf: authSessionId }),
    ]);

    const statusCodes = [first.statusCode, second.statusCode].sort();
    expect(statusCodes).toEqual([302, 400]);
    expect(await countAuthorizationCodes(realmName)).toBe(1);
  });
});

describe('realm isolation', () => {
  it('isolates authorization_codes by realm', async () => {
    await expectRealmIsolation(app.db, {
      table: 'authorization_codes',
      seed: async (tx, realmId) => {
        const clientDbId = newId();
        await tx.insert(realms).values({ id: realmId, name: `probe-${realmId}` });
        await tx.insert(clients).values({
          id: clientDbId,
          realmId,
          clientId: `probe-client-${realmId}`,
          name: 'Isolation probe client',
          type: 'confidential',
          secretHash: 'hashed:secret',
        });
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        await authorizationCodeRepository(tx).create({
          codeHash: hashAuthorizationCode(generateAuthorizationCode()),
          realmId,
          clientId: clientDbId,
          subjectId: subject.id,
          redirectUri: REDIRECT_URI,
          scope: 'openid',
          nonce: null,
          codeChallenge: 'a'.repeat(43),
          codeChallengeMethod: 'S256',
          authTime: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        });
      },
    });
  });
});

// OIDC Core §3.1.2.3: "If this parameter [prompt] contains login, the
// Authorization Server MUST reauthenticate the End-User even if the End-User
// is already authenticated." §15.1 makes that behaviour mandatory to
// implement. This server authenticates unconditionally — /authorize never
// reads the session cookie — so the requirement is met by construction; what
// these assertions hold is that a live session does not change the answer,
// and that `login` is a value the endpoint accepts rather than refuses.
describe('[OIDC-CORE-3.1.2.3-03] prompt=login authenticates again despite a live session', () => {
  it('renders a fresh login form for a request carrying the session cookie just set', async () => {
    const realmName = await setupLoginRealm(`acme-prompt-login-${newId()}`);
    const loggedIn = await submitLogin({ ...GOOD, realmName });
    const cookie = loggedIn.headers['set-cookie'];
    if (typeof cookie !== 'string') throw new Error('expected a session cookie to be set');

    const res = await http.inject({
      url: authorizeUrl(realmName, { prompt: 'login' }),
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
    // Not a silent authorization: no code reaches the client without the
    // End-User going through the form this response just served.
    expect(res.headers.location).toBeUndefined();
  });

  it('issues a code only once that second authentication is completed', async () => {
    const realmName = await setupLoginRealm(`acme-prompt-login-code-${newId()}`);
    await submitLogin({ ...GOOD, realmName });
    expect(await countAuthorizationCodes(realmName)).toBe(1);

    const res = await submitLogin({ ...GOOD, realmName, authorize: { prompt: 'login' } });
    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('code')).toBeTruthy();
    expect(await countAuthorizationCodes(realmName)).toBe(2);
  });
});

// OIDC Core §3.1.2.1: with an `id_token_hint`, "if the End-User identified by
// the ID Token is logged in or is logged in by the request, then the
// Authorization Server returns a positive response; otherwise, it SHOULD
// return an error, such as login_required". "Logged in by the request" is the
// only case this server has, so honouring the hint means comparing it to
// whoever actually signed in.
describe('[OIDC-CORE-3.1.2.1-09] an id_token_hint names who the response is about', () => {
  it('issues a code when the End-User who signs in is the one the hint identifies', async () => {
    const realmName = await setupLoginRealm(`acme-hint-match-${newId()}`);
    const hint = await mintIdToken(realmName, await subjectIdOf(realmName));

    const res = await submitLogin({ ...GOOD, realmName, authorize: { id_token_hint: hint } });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('error')).toBeNull();
  });

  it('answers login_required when somebody else signs in, and issues nothing', async () => {
    const realmName = await setupLoginRealm(`acme-hint-mismatch-${newId()}`);
    const hint = await mintIdToken(realmName, newId());

    const res = await submitLogin({ ...GOOD, realmName, authorize: { id_token_hint: hint } });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('code')).toBeNull();
    expect(location.searchParams.get('state')).toBe('xyz 123');
    expect(location.searchParams.get('iss')).toBe(await issuerFor(http, realmName));
    // The authentication succeeded and was still not turned into anything:
    // no code for the client, and no SSO session cookie for a login the
    // client's own request said it did not want.
    expect(await countAuthorizationCodes(realmName)).toBe(0);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

// OIDC Core §3.1.2.3: "the Authorization Server attempts to Authenticate the
// End-User" when the End-User is not already authenticated. Odudu never
// reads the SSO session cookie at /authorize, so no End-User ever is — which
// makes the obligation unconditional, and makes its two halves observable:
// the request is answered with an authentication interface rather than a
// grant, and nothing is granted until credentials have actually been
// verified.
describe('[OIDC-CORE-3.1.2.3-04] an unauthenticated request is answered by authenticating', () => {
  it('serves the login form and grants nothing to a request carrying no session', async () => {
    const realmName = await setupLoginRealm(`acme-authn-fresh-${newId()}`);
    const res = await http.inject({ url: authorizeUrl(realmName) });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await countAuthorizationCodes(realmName)).toBe(0);
  });

  it('grants nothing until the credentials presented actually verify', async () => {
    const realmName = await setupLoginRealm(`acme-authn-verify-${newId()}`);

    const wrong = await submitLogin({ ...GOOD, password: 'not the passphrase', realmName });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.headers.location).toBeUndefined();
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(await countAuthorizationCodes(realmName)).toBe(0);

    const right = await submitLogin({ ...GOOD, realmName });
    expect(right.statusCode).toBe(302);
    expect(new URL(locationHeader(right)).searchParams.get('code')).toBeTruthy();
    expect(await countAuthorizationCodes(realmName)).toBe(1);
  });

  // "Not already authenticated" is the only state this server recognises: a
  // request arriving with a live SSO session is authenticated again rather
  // than answered from it, so a stolen cookie cannot stand in for a login.
  it('authenticates again rather than answering from a session already established', async () => {
    const realmName = await setupLoginRealm(`acme-authn-session-${newId()}`);
    const loggedIn = await submitLogin({ ...GOOD, realmName });
    const cookie = loggedIn.headers['set-cookie'];
    if (typeof cookie !== 'string') throw new Error('expected a session cookie to be set');

    const res = await http.inject({
      url: authorizeUrl(realmName),
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
    expect(res.headers.location).toBeUndefined();
    expect(await countAuthorizationCodes(realmName)).toBe(1);
  });
});

// OIDC Core §3.1.2.2: "the Authorization Server MUST NOT reply with an ID
// Token or Access Token for a different User, even if they have an active
// session". The subject a journey yields comes from the authenticator's own
// result (usecase/login-submission.ts), never from a cookie, a form field or
// the parked request — so this is checked where it is observable: in the
// `sub` of the tokens two different End-Users' journeys produce.
describe('[OIDC-CORE-3.1.2.2-05] the tokens name the End-User who authenticated', () => {
  it('names the End-User who signed in, not the one whose session was presented', async () => {
    const realmName = await setupLoginRealm(`acme-two-users-${newId()}`);
    const ada = await subjectIdOf(realmName, USERNAME);
    const grace = await subjectIdOf(realmName, OTHER_USERNAME);
    expect(ada).not.toBe(grace);

    const first = await signInAndRedeem(realmName, GOOD);
    expect(subjectOf(first.tokens.id_token ?? '')).toBe(ada);

    // Grace's journey runs while Ada's session cookie is being presented —
    // the active session §3.1.2.2 warns about, belonging to somebody other
    // than whoever is signing in.
    if (first.cookie === undefined)
      throw new Error('expected a session cookie from the first login');
    const second = await signInAndRedeem(realmName, OTHER_USER, { cookie: first.cookie });

    expect(subjectOf(second.tokens.id_token ?? '')).toBe(grace);
    expect(subjectOf(second.tokens.access_token ?? '')).toBe(grace);
    expect(subjectOf(second.tokens.id_token ?? '')).not.toBe(ada);
    expect(subjectOf(second.tokens.access_token ?? '')).not.toBe(ada);
  });

  // Two journeys parked at once, completed by different End-Users in the
  // reverse order they were started: the binding that survives is each
  // journey's own authentication, not the order or the other journey.
  it('keeps two concurrently parked journeys bound to their own End-Users', async () => {
    const realmName = await setupLoginRealm(`acme-interleaved-${newId()}`);
    const ada = await subjectIdOf(realmName, USERNAME);
    const grace = await subjectIdOf(realmName, OTHER_USERNAME);

    const adaSession = await startAuthSession(http, realmName, { code_challenge: CHALLENGE });
    const graceSession = await startAuthSession(http, realmName, { code_challenge: CHALLENGE });

    const graceRes = await submitLogin({ ...OTHER_USER, realmName, csrf: graceSession });
    const adaRes = await submitLogin({ ...GOOD, realmName, csrf: adaSession });

    const graceCode = new URL(locationHeader(graceRes)).searchParams.get('code');
    const adaCode = new URL(locationHeader(adaRes)).searchParams.get('code');
    if (graceCode === null || adaCode === null) throw new Error('expected a code on each redirect');

    const graceTokens = (await redeemCode(realmName, graceCode)).json<TokenResponseBody>();
    const adaTokens = (await redeemCode(realmName, adaCode)).json<TokenResponseBody>();

    expect(subjectOf(graceTokens.id_token ?? '')).toBe(grace);
    expect(subjectOf(adaTokens.id_token ?? '')).toBe(ada);
  });
});

// OIDC Core §16.4: access tokens are not to reach unauthorized parties. The
// authorization server's own emissions are what it can be held to, and there
// are only three of them — the authorization response it puts in a Location
// header, the pages it renders, and the token response itself. The token
// response body, delivered to a client that authenticated for it, is the one
// place an access token is meant to appear; these assertions hold that it
// appears nowhere else, and that the one response carrying it is not
// cacheable by anything in between.
describe('[OIDC-CORE-16.4-01] an access token reaches nothing but the token response', () => {
  it('keeps the authorization response to code, state and iss', async () => {
    const realmName = await setupLoginRealm(`acme-exposure-redirect-${newId()}`);
    const res = await submitLogin({ ...GOOD, realmName });
    const returned = new URL(locationHeader(res));

    expect([...returned.searchParams.keys()].sort()).toEqual(['code', 'iss', 'state']);
    expect(returned.hash).toBe('');
  });

  it('sets no cookie on the token response and forbids it being stored', async () => {
    const realmName = await setupLoginRealm(`acme-exposure-token-${newId()}`);
    const res = await submitLogin({
      ...GOOD,
      realmName,
      authorize: { code_challenge: CHALLENGE },
    });
    const code = new URL(locationHeader(res)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the login redirect');

    const redeemed = await redeemCode(realmName, code);
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.headers['set-cookie']).toBeUndefined();
    expect(redeemed.headers['cache-control']).toBe('no-store');
    expect(redeemed.headers.pragma).toBe('no-cache');
  });

  it('puts no access token in any redirect or rendered page of a later journey', async () => {
    const realmName = await setupLoginRealm(`acme-exposure-later-${newId()}`);
    const issued = await signInAndRedeem(realmName, GOOD);
    const accessToken = issued.tokens.access_token;
    if (accessToken === undefined) throw new Error('expected an access token');

    // The same End-User, the same client, a fresh journey, carrying the SSO
    // session the first one established: the login form and the redirect it
    // leads to are both searched for the token that already exists.
    const form = await http.inject({
      url: authorizeUrl(realmName),
      ...(issued.cookie !== undefined ? { headers: { cookie: issued.cookie } } : {}),
    });
    expect(form.body).not.toContain(accessToken);

    const next = await submitLogin({ ...GOOD, realmName });
    expect(locationHeader(next)).not.toContain(accessToken);
    expect(next.body).not.toContain(accessToken);
    expect(String(next.headers['set-cookie'])).not.toContain(accessToken);
  });
});

// OIDC Core §16.22: a 307 is the one redirect status that requires the user
// agent to repeat the method and body it just sent — which, for a redirect
// issued from the login form's own POST, would resend the End-User's
// credentials to the client's redirection URI.
describe('[OIDC-CORE-16.22-01] the redirect to the redirection URI is never a 307', () => {
  it('answers a completed login with 302, not 307 or 308', async () => {
    const realmName = await setupLoginRealm(`acme-307-success-${newId()}`);
    const res = await submitLogin({ ...GOOD, realmName });

    expect(locationHeader(res)).toContain(REDIRECT_URI);
    expect(res.statusCode).toBe(302);
    expect([307, 308]).not.toContain(res.statusCode);
  });

  it('answers a login that ends in an error redirect with 302 too', async () => {
    const realmName = await setupLoginRealm(`acme-307-error-${newId()}`);
    const hint = await mintIdToken(realmName, newId());
    const res = await submitLogin({ ...GOOD, realmName, authorize: { id_token_hint: hint } });

    expect(new URL(locationHeader(res)).searchParams.get('error')).toBe('login_required');
    expect(res.statusCode).toBe(302);
    expect([307, 308]).not.toContain(res.statusCode);
  });
});

// The other half of RFC 6749 §10.13's obligation, on the other handler that
// renders to the End-User. The CSRF token above stops a cross-site *form
// submission*; it does nothing about a cross-site *frame*, where the
// submission is genuine and same-origin and it is the End-User who has been
// deceived about what they were clicking. Both pages this handler renders
// are covered: the re-challenge form, where the credentials are typed, and
// the error page, which is as framable and as persuasive as any other.
describe('[OIDC-CORE-3.1.2.3-05] no page the login handler renders can be framed', () => {
  function expectRefusesFraming(res: LightMyRequestResponse, what: string): void {
    expect(`${what}: ${String(res.headers['content-type'])}`).toContain('text/html');
    expect(`${what}: ${String(res.headers['content-security-policy'])}`).toContain(
      "frame-ancestors 'none'",
    );
    expect(`${what}: ${String(res.headers['x-frame-options'])}`).toBe(`${what}: DENY`);
  }

  it('refuses framing on the form a wrong password re-challenges with', async () => {
    const realmName = await setupLoginRealm(`acme-framing-rechallenge-${newId()}`);
    const res = await submitLogin({ ...GOOD, password: 'wrong', realmName });
    expect(res.statusCode).toBe(200);
    expectRefusesFraming(res, 'the re-challenge form');
  });

  it('refuses framing on the error page an unusable session is refused with', async () => {
    const res = await submitLogin({ ...GOOD, csrf: null });
    expect(res.statusCode).toBe(400);
    expectRefusesFraming(res, 'the error page');
  });
});
