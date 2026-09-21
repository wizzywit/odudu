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
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';

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
let ISSUER: string;

const KEK = Buffer.alloc(32, 29);

const CLIENT_ID = 'revoke-client';
const CLIENT_SECRET = 'revoke-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'grace';
const PASSWORD = 'correct horse battery staple';

// The client under test is also the resource server it introspects
// against, so revocation's effect on `active` can be observed with no
// third client: its own `audiences` name its own `client_id`, which is
// what `callerIsAddressed` (introspection.ts) checks entitlement against.
const RESOURCE_AUDIENCE = CLIENT_ID;

// A second confidential client — the token under test is never issued to
// this one, which is what makes "issued to another client" a real,
// found-but-foreign grant rather than the endpoint's unknown-token path.
const OTHER_CLIENT_ID = 'revoke-other-client';
const OTHER_CLIENT_SECRET = 'revoke-other-client-secret';

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function registerConfidentialClient(
  tx: RealmScopedDatabase,
  clientId: string,
  secret: string,
): Promise<void> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    realmId: REALM_ID,
    clientId,
    name: clientId,
    type: 'confidential',
    secretHash: await hashPassword(secret),
  });
  await provisionClientDefaults(tx, dbId);
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    realmId: REALM_ID,
    redirectUris: [],
    // Never actually used to redeem a client_credentials grant — this
    // client exists only to authenticate at /revoke as somebody else's
    // client_id — but `client_oidc_config_redirect_uris_present` requires
    // either a redirect_uri or exactly this grant type.
    grantTypes: ['client_credentials'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
  });
}

async function setupRealm(): Promise<void> {
  REALM = `revoke-${newId()}`;
  REALM_ID = newId();
  ISSUER = `http://localhost/realms/${REALM}`;

  const clientDbId = newId();
  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await provisionRealm(tx, REALM_ID);

    await tx.insert(clients).values({
      id: clientDbId,
      realmId: REALM_ID,
      clientId: CLIENT_ID,
      name: 'revoke test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [RESOURCE_AUDIENCE],
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

    await registerConfidentialClient(tx, OTHER_CLIENT_ID, OTHER_CLIENT_SECRET);

    const key = await generateSigningKey('ES256', KEK);
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

function authorizeUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/realms/${REALM}/protocol/openid-connect/auth?${params.toString()}`;
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

async function redeemCode(code: string): Promise<{ access_token: string; refresh_token: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  const res = await http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(res.statusCode)}`);
  }
  return res.json<{ access_token: string; refresh_token: string }>();
}

async function completeAuthorizationCodeFlow(): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const authorize = await http.inject({ url: authorizeUrl() });
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
    url: `/realms/${REALM}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const redeemed = await redeemCode(code);
  return { accessToken: redeemed.access_token, refreshToken: redeemed.refresh_token };
}

function basic(clientId: string, secret: string): { clientId: string; secret: string } {
  return { clientId, secret };
}

async function revoke(opts: {
  token: string;
  auth: { clientId: string; secret: string } | null;
}): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('token', opts.token);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (opts.auth !== null) {
    headers.authorization = `Basic ${Buffer.from(`${opts.auth.clientId}:${opts.auth.secret}`).toString('base64')}`;
  }

  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/revoke`,
    payload: form.toString(),
    headers,
  });
}

async function redeemRefresh(refreshToken: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
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

async function introspectActive(token: string): Promise<boolean> {
  const form = new URLSearchParams();
  form.set('token', token);
  const res = await http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token/introspect`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  return res.json<{ active: boolean }>().active;
}

async function discovery(): Promise<{ revocation_endpoint: string }> {
  const res = await http.inject({ url: `/realms/${REALM}/.well-known/openid-configuration` });
  return res.json<{ revocation_endpoint: string }>();
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

const client = basic(CLIENT_ID, CLIENT_SECRET);
const otherClient = basic(OTHER_CLIENT_ID, OTHER_CLIENT_SECRET);

describe('[ODUDU-REVOKE-AUTH-01] the revocation endpoint requires client authentication', () => {
  it('refuses an unauthenticated call', async () => {
    const { refreshToken } = await completeAuthorizationCodeFlow();
    const response = await revoke({ token: refreshToken, auth: null });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe('invalid_client');
  });
});

describe('[RFC7009-2.1-02] a refresh token names the grant it revokes', () => {
  it('revokes a refresh token and answers 200', async () => {
    const { refreshToken } = await completeAuthorizationCodeFlow();
    const response = await revoke({ token: refreshToken, auth: client });
    expect(response.statusCode).toBe(200);
    expect((await redeemRefresh(refreshToken)).json<{ error: string }>().error).toBe(
      'invalid_grant',
    );
  });
});

describe('[ODUDU-REVOKE-UNKNOWN-01] an unknown token is not an error', () => {
  it('answers 200 for a token that does not exist, per §2.2', async () => {
    const response = await revoke({ token: 'nonsense', auth: client });
    expect(response.statusCode).toBe(200);
  });
});

describe('[ODUDU-REVOKE-ALREADY-REVOKED-01] an already-revoked token is not an error either', () => {
  it('answers 200 for an already-revoked token', async () => {
    const { refreshToken } = await completeAuthorizationCodeFlow();
    // First presentation genuinely revokes the grant — proven separately
    // by RFC7009-2.1-02 above — so this test's own 200 can only be the
    // second call's no-op path, never the first revocation succeeding
    // twice by coincidence.
    await revoke({ token: refreshToken, auth: client });
    const response = await revoke({ token: refreshToken, auth: client });
    expect(response.statusCode).toBe(200);
  });
});

describe('[ODUDU-REVOKE-OTHER-CLIENT-01] a token found under another client is refused, not treated as unknown', () => {
  it('refuses to revoke a token issued to another client', async () => {
    const { refreshToken } = await completeAuthorizationCodeFlow();
    const response = await revoke({ token: refreshToken, auth: otherClient });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_grant');

    // The boundary only means something if the token is still usable by
    // its real owner afterward — otherwise this test cannot be told apart
    // from the endpoint having revoked it anyway and answered the wrong
    // status.
    const stillLive = await redeemRefresh(refreshToken);
    expect(stillLive.statusCode).toBe(200);
  });

  it('refuses to revoke an access token issued to another client, the same way', async () => {
    const { accessToken } = await completeAuthorizationCodeFlow();
    const response = await revoke({ token: accessToken, auth: otherClient });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_grant');
    expect(await introspectActive(accessToken)).toBe(true);
  });
});

describe('[RFC7009-2.1-04] an access token names the same grant a refresh token does', () => {
  it('revokes the whole grant when an access token is presented', async () => {
    const { accessToken } = await completeAuthorizationCodeFlow();
    expect(await introspectActive(accessToken)).toBe(true);
    await revoke({ token: accessToken, auth: client });
    expect(await introspectActive(accessToken)).toBe(false);
  });

  it('reaches the refresh token even after it has rotated', async () => {
    const { accessToken, refreshToken } = await completeAuthorizationCodeFlow();
    const rotated = await redeemRefresh(refreshToken);
    expect(rotated.statusCode).toBe(200);
    const rotatedRefreshToken = rotated.json<{ refresh_token: string }>().refresh_token;
    expect(rotatedRefreshToken).not.toBe(refreshToken);

    await revoke({ token: accessToken, auth: client });

    const afterRevocation = await redeemRefresh(rotatedRefreshToken);
    expect(afterRevocation.statusCode).toBe(400);
    expect(afterRevocation.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

describe('[RFC7009-2.1-05] revoking a refresh token also invalidates its access token', () => {
  it('reports the sibling access token inactive, not merely the refresh token', async () => {
    const { accessToken, refreshToken } = await completeAuthorizationCodeFlow();
    expect(await introspectActive(accessToken)).toBe(true);
    await revoke({ token: refreshToken, auth: client });
    expect(await introspectActive(accessToken)).toBe(false);
  });
});

describe('[ODUDU-REVOKE-DISCOVERY-01] the endpoint is advertised in discovery', () => {
  it('advertises the endpoint in discovery', async () => {
    expect((await discovery()).revocation_endpoint).toBe(
      `${ISSUER}/protocol/openid-connect/revoke`,
    );
  });
});
