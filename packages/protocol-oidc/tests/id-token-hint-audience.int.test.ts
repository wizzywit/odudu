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
import { sessionRepository, provisionRealm, type SessionLifespans } from '@odudu/authn-flows';
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

// A hint's `aud` is the client it was issued to, not this server, so an
// audience check on it is an additional guard this server chooses to make
// (sign.ts's AUDIENCE_UNCHECKED comment) rather than an RFC 7519 §4.1.3
// obligation being met. /authorize now makes that choice against the
// requesting client; /logout still declines it — see
// docs/protocols/oidc-core.md's reading note for why the two differ.

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
const KEK = Buffer.alloc(32, 13);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function makeSigningKey(realmId: string): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('ES256', KEK);
  return {
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
}

// A realm carrying both clients this suite plays against each other
// (client-a is always the one requesting; client-b exists only to be
// named in the wrong place), plus one signing key and one seeded user.
async function setupRealm(name: string): Promise<{ realmId: string }> {
  const realmId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealm(tx, realmId);

    for (const clientId of [CLIENT_A_ID, CLIENT_B_ID]) {
      const dbId = newId();
      await tx.insert(clients).values({
        id: dbId,
        realmId,
        clientId,
        name: `Test client ${clientId}`,
        type: 'confidential',
        secretHash: await hashPassword(`${clientId}-secret`),
      });
      await provisionClientDefaults(tx, dbId);
      await clientOidcConfigRepository(tx).create({
        clientId: dbId,
        realmId,
        redirectUris: [REDIRECT_URI],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
    }

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });

    const key = await makeSigningKey(realmId);
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

async function mintHint(realmName: string, aud: string, sub: string): Promise<string> {
  const key = signingKeyOf.get(realmName);
  if (key === undefined) throw new Error(`no signing key for ${realmName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { iss: await issuerFor(realmName), aud, sub, iat: now, exp: now + 300 },
    { key, kek: KEK },
  );
}

function authorizeUrl(
  realmName: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_A_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
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
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values.find((value) => !value.includes('-persistent='))?.split(';')[0];
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

function sessionIdFromCookie(cookie: string): string {
  const id = cookie.split('=')[1];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

// Signs USERNAME/PASSWORD in against client-a's own parked request and
// returns the SSO session cookie the login redirect set.
async function signIn(realmName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(realmName) });
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
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  return cookie;
}

function logoutUrl(realmName: string, overrides: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/realms/${realmName}/protocol/openid-connect/logout?${query.toString()}`;
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

describe('/authorize checks an id_token_hint against the requesting client', () => {
  it('accepts a hint minted for the requesting client', async () => {
    const realmName = `hint-aud-accept-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const cookie = await signIn(realmName);

    const hint = await mintHint(realmName, CLIENT_A_ID, subjectId);

    const res = await http.inject({
      url: authorizeUrl(realmName, { id_token_hint: hint }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('error')).toBeNull();
  });

  it('refuses a hint minted for another client', async () => {
    const realmName = `hint-aud-wrong-client-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const hint = await mintHint(realmName, CLIENT_B_ID, subjectId);

    const res = await http.inject({
      url: authorizeUrl(realmName, { client_id: CLIENT_A_ID, id_token_hint: hint }),
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBe('invalid_request');
  });
});

describe('/logout leaves its own id_token_hint audience handling unchanged', () => {
  // /logout has no principal of its own to check `aud` against, so a hint
  // naming a client entirely unrelated to the one logging out must still
  // be honoured here — proven by omitting
  // client_id, so RP-Initiated Logout §2's own client_id-vs-hint check
  // (a separate, pre-existing rule) cannot be what is doing the work.
  // Passing CLIENT_A_ID instead of AUDIENCE_UNCHECKED at the /logout call
  // site would make this hint fail verification outright and this
  // assertion would fail.
  it('still ends a session on a hint whose aud names an unrelated client', async () => {
    const realmName = `hint-aud-logout-unchanged-${newId()}`;
    const { realmId } = await setupRealm(realmName);
    const subjectId = await subjectIdOf(realmId, USERNAME);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const iss = await issuerFor(realmName);

    const key = signingKeyOf.get(realmName);
    if (key === undefined) throw new Error('no signing key');
    const now = Math.floor(Date.now() / 1000);
    const hint = await signJwt(
      { iss, aud: CLIENT_B_ID, sub: subjectId, sid: sessionId, iat: now, exp: now + 300 },
      { key, kek: KEK },
    );

    const res = await http.inject({
      url: logoutUrl(realmName, { id_token_hint: hint }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<title>Sign out?</title>');

    const stillLive = await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).liveById(sessionId, GENEROUS_LIFESPANS, new Date()),
    );
    expect(stillLive).toBeNull();
  });
});
