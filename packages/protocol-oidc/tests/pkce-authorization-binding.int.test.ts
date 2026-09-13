import { createHash } from 'node:crypto';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
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
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodes } from '#/schema/authorization-codes';

// What /authorize was told and what /token later checks are two ends of the
// same journey, and nothing short of running it observes the binding
// between them: a code written straight into the table by a repository
// carries whatever challenge the test chose, which is the question rather
// than the answer. So this file drives the whole thing — park the request,
// sign the End-User in, redeem what comes back.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

let REALM: string;
let REALM_ID: string;

const CLIENT_ID = 'pkce-binding-client';
const CLIENT_SECRET = 'pkce-binding-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 5);

function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

// RFC 7636 Appendix B's worked example, and a second pair of the same shape
// so "the challenge this request carried" can be told from "some challenge
// this server would accept".
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const OTHER_VERIFIER = 'Zx7Qp2Lm9Rt4Vw8Yb1Nc6Hd3Jf5Kg0Sa-_.~ABCDEFG';
const OTHER_CHALLENGE = s256(OTHER_VERIFIER);

async function setupRealm(): Promise<void> {
  REALM = `pkce-binding-${newId()}`;
  REALM_ID = newId();
  const clientDbId = newId();

  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await tx.insert(clients).values({
      id: clientDbId,
      realmId: REALM_ID,
      clientId: CLIENT_ID,
      name: 'PKCE binding client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const subject = await subjectRepository(tx).create({ realmId: REALM_ID, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId: REALM_ID, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId: REALM_ID,
      subjectId: subject.id,
      type: 'password',
      secretData: await hashPassword(PASSWORD),
    });

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId: REALM_ID,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
}

function authorizeUrl(overrides: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile',
    state: 'xyz 123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/realms/${REALM}/protocol/openid-connect/auth?${query.toString()}`;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

interface Journey {
  authorize: LightMyRequestResponse;
  login: LightMyRequestResponse;
  code: string;
}

// /authorize renders the login form, the form is submitted, and the
// redirect that answers it carries the code. Both responses are kept: what
// the client is handed along the way is itself under test.
async function signIn(overrides: Record<string, string | undefined> = {}): Promise<Journey> {
  const authorize = await http.inject({ url: authorizeUrl(overrides) });
  expect(authorize.statusCode).toBe(200);

  const sessionId = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body)?.[1];
  if (sessionId === undefined) throw new Error('no auth_session_id in the rendered login form');

  const form = new URLSearchParams({
    auth_session_id: sessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const login = await http.inject({
    method: 'POST',
    url: `/realms/${REALM}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(login.statusCode).toBe(302);

  const code = new URL(locationHeader(login)).searchParams.get('code');
  if (code === null) throw new Error('no code on the login redirect');
  return { authorize, login, code };
}

async function redeem(code: string, verifier: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
}

async function authorizationCodeCount(): Promise<number> {
  const rows = await owner.db
    .select({ codeHash: authorizationCodes.codeHash })
    .from(authorizationCodes)
    .where(eq(authorizationCodes.realmId, REALM_ID));
  return rows.length;
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

  await setupRealm();

  http = Fastify();
  await http.register(formbody);
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK }));
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[RFC7636-4.3-01] a code challenge is required on the authorization request', () => {
  it('refuses a request carrying none, and leaves no code behind to redeem', async () => {
    const before = await authorizationCodeCount();

    const res = await http.inject({ url: authorizeUrl({ code_challenge: undefined }) });
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('code')).toBeNull();
    expect(res.body).not.toContain('auth_session_id');

    expect(await authorizationCodeCount()).toBe(before);
  });
});

describe('[RFC7636-4.4-01] the challenge and its transform are bound to the code that was issued', () => {
  it('redeems only with the verifier for the challenge that authorization request carried', async () => {
    const wrongPair = await signIn({ code_challenge: OTHER_CHALLENGE });
    const refused = await redeem(wrongPair.code, VERIFIER);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: string }>().error).toBe('invalid_grant');

    const rightPair = await signIn({ code_challenge: OTHER_CHALLENGE });
    expect((await redeem(rightPair.code, OTHER_VERIFIER)).statusCode).toBe(200);
  });

  // The transform is bound alongside the challenge, so a challenge that
  // happens to equal its own verifier — what `plain` would produce — is
  // still hashed before the comparison.
  it('compares the S256 digest of the verifier, never the verifier itself', async () => {
    const { code } = await signIn({ code_challenge: VERIFIER });
    const res = await redeem(code, VERIFIER);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

function headerText(res: LightMyRequestResponse): string {
  return Object.entries(res.headers)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join('\n');
}

describe('[RFC7636-4.4-02] the code challenge is not handed back to anyone', () => {
  it('appears in nothing the client receives across the whole journey', async () => {
    const journey = await signIn();
    const redeemed = await redeem(journey.code, VERIFIER);
    expect(redeemed.statusCode).toBe(200);

    const received = [
      journey.authorize.body,
      headerText(journey.authorize),
      journey.login.body,
      headerText(journey.login),
      redeemed.body,
      headerText(redeemed),
    ];

    for (const text of received) {
      expect(text).not.toContain(CHALLENGE);
      expect(text).not.toContain(VERIFIER);
    }
  });
});

function setCookies(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// A JWS Compact Serialization: three base64url segments, the last possibly
// empty. Every token this server hands a client is one, so a cookie value
// of that shape is a token in a cookie whether or not it is one of the
// three this journey happened to produce.
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

describe('[RFC6750-5.2-04] no bearer token is ever put in a cookie', () => {
  it('sets cookies during the journey, and none of them carries a token', async () => {
    const journey = await signIn();
    const redeemed = await redeem(journey.code, VERIFIER);
    expect(redeemed.statusCode).toBe(200);
    const tokens = redeemed.json<{
      access_token: string;
      id_token?: string;
      refresh_token?: string;
    }>();
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.id_token).toBeDefined();

    const userinfoRes = await http.inject({
      url: `/realms/${REALM}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(userinfoRes.statusCode).toBe(200);

    const cookies = [journey.authorize, journey.login, redeemed, userinfoRes].flatMap(setCookies);
    // Vacuously true if this journey set no cookie at all, which would make
    // the assertions below prove nothing about the one it does set.
    expect(cookies.length).toBeGreaterThan(0);

    for (const cookie of cookies) {
      for (const token of [tokens.access_token, tokens.id_token, tokens.refresh_token]) {
        if (token !== undefined) expect(cookie).not.toContain(token);
      }
      const value = cookie.split(';')[0]?.split('=').slice(1).join('=') ?? '';
      expect(value).not.toMatch(COMPACT_JWS);
    }
  });
});
