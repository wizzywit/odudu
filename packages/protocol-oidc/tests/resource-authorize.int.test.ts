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
import { provisionRealm } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodes } from '#/schema/authorization-codes';
import { hashAuthorizationCode } from '#/service/authorization-code';

// RFC 8707 §2 at /authorize: a registered audience is recorded on the
// code, an unregistered one is refused, and a client that registered none
// still succeeds — every client in this repository has `audiences` `[]`
// today, and the endpoint must not start refusing every request in the
// system the day this column exists.

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

const CLIENT_ID = 'resource-client';
const CLIENT_NO_AUDIENCE_ID = 'resource-client-no-audience';
const CLIENT_MALFORMED_ID = 'resource-client-malformed-audiences';
const PASSWORD = 'correct horse battery staple';
const USERNAME = 'ada';
const REDIRECT_URI = 'https://app.example/callback';
const KEK = Buffer.alloc(32, 7);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const REGISTERED_AUDIENCES = ['https://api.example', 'https://reports.example'];
// Registered literally, on a client of its own, so that the absolute-URI
// and no-fragment MUSTs are isolated from the membership check: if either
// were deleted, the value would still be found in this list and the
// request would succeed, which is what proves the deleted check — not
// membership — was refusing it (see 6b4d020's fix for the same shape in
// the unit suite).
const MALFORMED_NOT_A_URI = 'not-a-uri';
const MALFORMED_WITH_FRAGMENT = 'https://api.example/reports#frag';

async function setupRealm(): Promise<void> {
  REALM = `resource-authorize-${newId()}`;
  REALM_ID = newId();

  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await provisionRealm(tx, REALM_ID);

    const withAudienceId = newId();
    await tx.insert(clients).values({
      id: withAudienceId,
      realmId: REALM_ID,
      clientId: CLIENT_ID,
      name: 'Client with a registered audience',
      type: 'confidential',
      secretHash: await hashPassword('resource-client-secret'),
    });
    await provisionClientDefaults(tx, withAudienceId);
    await clientOidcConfigRepository(tx).create({
      clientId: withAudienceId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: REGISTERED_AUDIENCES,
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const noAudienceId = newId();
    await tx.insert(clients).values({
      id: noAudienceId,
      realmId: REALM_ID,
      clientId: CLIENT_NO_AUDIENCE_ID,
      name: 'Client with no registered audience',
      type: 'confidential',
      secretHash: await hashPassword('resource-client-no-audience-secret'),
    });
    await provisionClientDefaults(tx, noAudienceId);
    await clientOidcConfigRepository(tx).create({
      clientId: noAudienceId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const malformedId = newId();
    await tx.insert(clients).values({
      id: malformedId,
      realmId: REALM_ID,
      clientId: CLIENT_MALFORMED_ID,
      name: 'Client with literally-registered malformed values',
      type: 'confidential',
      secretHash: await hashPassword('resource-client-malformed-secret'),
    });
    await provisionClientDefaults(tx, malformedId);
    await clientOidcConfigRepository(tx).create({
      clientId: malformedId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [MALFORMED_NOT_A_URI, MALFORMED_WITH_FRAGMENT],
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
      secretData: { hash: await hashPassword(PASSWORD) },
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

function authorizeUrl(
  clientId: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: clientId,
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
  return `/realms/${REALM}/protocol/openid-connect/auth?${query.toString()}`;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

function cookieHeaderFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const cookies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const header = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  if (header === '') throw new Error('expected a session cookie from a successful login');
  return header;
}

// Signs the one seeded subject in against `clientId`'s own parked request —
// an ordinary, first-time form login, the door most requests actually take
// — and returns both the code that login mints and the SSO session cookie
// it establishes. The session itself is not scoped to `clientId`, so a
// later /authorize for either seeded client can reuse the cookie.
async function formLogin(
  clientId: string,
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: string; cookie: string }> {
  const authorize = await http.inject({ url: authorizeUrl(clientId, overrides) });
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
  if (code === null) throw new Error('expected a code on the login redirect');
  return { code, cookie: cookieHeaderFrom(login) };
}

async function establishSession(clientId: string): Promise<string> {
  return (await formLogin(clientId)).cookie;
}

// Renders the account chooser (`prompt=select_account` against a single
// live session still counts as "more than one answer possible" —
// decideReuse's own rule), picks the one account offered, and returns the
// code the chooser's own POST mints.
async function chooseAccount(
  clientId: string,
  cookie: string,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const select = await http.inject({
    url: authorizeUrl(clientId, { prompt: 'select_account', ...overrides }),
    headers: { cookie },
  });
  expect(select.statusCode).toBe(200);

  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(select.body)?.[1];
  const sessionId = /name="session_id" value="([^"]*)"/.exec(select.body)?.[1];
  if (authSessionId === undefined || sessionId === undefined) {
    throw new Error('expected the chooser page to carry auth_session_id and session_id');
  }

  const form = new URLSearchParams({ auth_session_id: authSessionId, session_id: sessionId });
  const chosen = await http.inject({
    method: 'POST',
    url: `/realms/${REALM}/login-actions/select-account`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
  expect(chosen.statusCode).toBe(302);
  const code = new URL(locationHeader(chosen)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the chooser redirect');
  return code;
}

// A second /authorize for a live SSO cookie takes the session-reuse path,
// answering with a redirect straight away — no form, no consent, since
// neither client requires it. Returns the code that redirect carries.
async function authorizeWith(
  clientId: string,
  cookie: string,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(clientId, overrides), headers: { cookie } });
  expect(res.statusCode).toBe(302);
  const location = new URL(locationHeader(res));
  const code = location.searchParams.get('code');
  if (code === null) {
    throw new Error(`expected a code, got error=${location.searchParams.get('error') ?? 'none'}`);
  }
  return code;
}

async function authorize(
  overrides: Record<string, string | undefined> = {},
  clientId: string = CLIENT_ID,
): Promise<LightMyRequestResponse> {
  return http.inject({ url: authorizeUrl(clientId, overrides) });
}

// For a literal duplicate `resource` key, which URLSearchParams (used by
// authorizeUrl) cannot express — `.set` on a repeated key collapses it to
// one, and this is exactly the shape parseResource must refuse.
async function authorizeRaw(
  extraQuery: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return http.inject({ url: `${authorizeUrl(CLIENT_ID)}&${extraQuery}`, headers });
}

async function resourceOf(code: string): Promise<string[]> {
  const rows = await owner.db
    .select({ resource: authorizationCodes.resource })
    .from(authorizationCodes)
    .where(eq(authorizationCodes.codeHash, hashAuthorizationCode(code)));
  const row = rows[0];
  if (row === undefined) throw new Error('no authorization_codes row for that code');
  return row.resource;
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
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
    }),
  );
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[ODUDU-RESOURCE-01] a resource named in the registered list is recorded on the code', () => {
  it('records the requested resource on the code', async () => {
    const cookie = await establishSession(CLIENT_ID);
    const code = await authorizeWith(CLIENT_ID, cookie, { resource: 'https://api.example' });
    expect(await resourceOf(code)).toEqual(['https://api.example']);
  });
});

describe('[ODUDU-RESOURCE-02] a resource outside the registered list is refused', () => {
  it('redirects with invalid_target for an unregistered resource', async () => {
    const response = await authorize({ resource: 'https://elsewhere.example' });
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('error')).toBe('invalid_target');
  });

  it('redirects with invalid_target for two resources', async () => {
    const response = await authorizeRaw(
      'resource=https://api.example&resource=https://reports.example',
    );
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('error')).toBe('invalid_target');
  });
});

describe('[RFC8707-2-04] a resource value must be an absolute URI', () => {
  it('redirects with invalid_target for a value that is not an absolute URI, even when that exact string is registered', async () => {
    const response = await authorize({ resource: MALFORMED_NOT_A_URI }, CLIENT_MALFORMED_ID);
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('error')).toBe('invalid_target');
  });
});

describe('[RFC8707-2-05] a resource value must carry no fragment', () => {
  it('redirects with invalid_target for a value with a fragment, even when that exact string is registered', async () => {
    const response = await authorize({ resource: MALFORMED_WITH_FRAGMENT }, CLIENT_MALFORMED_ID);
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('error')).toBe('invalid_target');
  });
});

describe('[ODUDU-RESOURCE-03] no resource asked for records the whole registered list', () => {
  it('records every registered audience when no resource is asked for', async () => {
    const cookie = await establishSession(CLIENT_ID);
    const code = await authorizeWith(CLIENT_ID, cookie, {});
    expect(await resourceOf(code)).toEqual(REGISTERED_AUDIENCES);
  });

  // The correction this task exists to protect: every client in this
  // repository has `audiences` `[]` today, so an empty resolved audience
  // must still succeed rather than refuse every request in the system.
  it('still issues a code, with an empty stored resource, for a client with no registered audience', async () => {
    const cookie = await establishSession(CLIENT_NO_AUDIENCE_ID);
    const code = await authorizeWith(CLIENT_NO_AUDIENCE_ID, cookie, {});
    expect(await resourceOf(code)).toEqual([]);
  });
});

// RFC 6749 §3.1 ([RFC6749-3.1-01] in query-normalization.test.ts): "a
// parameter sent without a value is treated as if it had been omitted".
// `resourceParam` reads the raw query directly (it must see a real array
// for a genuine repeat, which normalizeAuthorizeQuery's params object
// cannot carry), so it has to apply this rule itself rather than inherit
// it — see resourceParam's own comment.
describe('[ODUDU-RESOURCE-04] an empty resource value is an omitted parameter, not a refusal', () => {
  it('resolves ?resource= alone to the registered list, same as no resource at all', async () => {
    const cookie = await establishSession(CLIENT_ID);
    const code = await authorizeWith(CLIENT_ID, cookie, { resource: '' });
    expect(await resourceOf(code)).toEqual(REGISTERED_AUDIENCES);
  });

  it('resolves resource=<value>&resource= to the single non-empty value', async () => {
    const cookie = await establishSession(CLIENT_ID);
    const response = await authorizeRaw('resource=https://api.example&resource=', {
      cookie,
    });
    expect(response.statusCode).toBe(302);
    const code = new URL(locationHeader(response)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the redirect');
    expect(await resourceOf(code)).toEqual(['https://api.example']);
  });
});

// `PendingRequest.resource` carries the resolved audience across the two
// doors that mint a code by way of a parked authentication session —an
// ordinary first-time form login, and the account chooser — the same
// value the immediate session-reuse door stores directly.
describe('[ODUDU-RESOURCE-05] resource reaches the code through every door that mints one', () => {
  it('is stored from an ordinary, first-time form login', async () => {
    const { code } = await formLogin(CLIENT_ID, { resource: 'https://api.example' });
    expect(await resourceOf(code)).toEqual(['https://api.example']);
  });

  it('is stored through the account chooser', async () => {
    const { cookie } = await formLogin(CLIENT_ID);
    const code = await chooseAccount(CLIENT_ID, cookie, { resource: 'https://reports.example' });
    expect(await resourceOf(code)).toEqual(['https://reports.example']);
  });
});
