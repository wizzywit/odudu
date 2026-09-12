import { generateSigningKey, signingKeyRepository, signingKeys, verifyJwt } from '@odudu/crypto';
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
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 9);
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'alice';
const PASSWORD = 'correct horse battery staple';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Client {
  clientId: string;
  dbId: string;
  secret: string;
}

interface RealmSetup {
  realmName: string;
  realmId: string;
  issuer: string;
  subjectId: string;
}

let realmA: RealmSetup;
let realmB: RealmSetup;
let sharedApp: { a: Client; b: Client };
let audienceA: Client;
let audienceB: Client;

async function insertClient(
  tx: RealmScopedDatabase,
  realmId: string,
  clientId: string,
  secret: string,
  audiences: string[] = [],
): Promise<Client> {
  const dbId = newId();
  await tx.insert(clients).values({
    id: dbId,
    realmId,
    clientId,
    name: clientId,
    type: 'confidential',
    secretHash: await hashPassword(secret),
  });
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    realmId,
    redirectUris: [REDIRECT_URI],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences,
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
  });
  return { clientId, dbId, secret };
}

async function setupRealm(label: string): Promise<RealmSetup> {
  const realmName = `cross-realm-${label}-${newId()}`;
  const realmId = newId();

  const subjectId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: await hashPassword(PASSWORD),
    });

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });

    return subject.id;
  });

  // Port included: light-my-request sends `Host: localhost:80`, and the
  // issuer names the authority the client addressed
  // (packages/protocol-oidc/src/view/issuer.ts).
  return { realmName, realmId, issuer: `http://localhost:80/realms/${realmName}`, subjectId };
}

function basicAuth(client: Client): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

function authorizeUrl(realmName: string, client: Client): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/realms/${realmName}/protocol/openid-connect/auth?${query.toString()}`;
}

// Issues an authorization code directly against the repository (as the
// other adversarial suites do, bypassing /authorize's login UI) and
// redeems it through the real /token endpoint.
async function issueTokens(
  realm: RealmSetup,
  client: Client,
  scope: string,
): Promise<{ accessToken: string; idToken: string | undefined; refreshToken: string | undefined }> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      realmId: realm.realmId,
      clientId: client.dbId,
      subjectId: realm.subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realm.realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string; refresh_token?: string }>();
  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
  };
}

async function realmSigningKeys(realmId: string) {
  return withRealm(app.db, realmId, (tx) => signingKeyRepository(tx).listPublishable());
}

// Stands in for a protected API validating a bearer token it received:
// the only thing it should trust is `verifyJwt`'s own audience check.
async function verifyAsResourceServer(
  realm: RealmSetup,
  token: string,
  audience: string,
): Promise<boolean> {
  const keys = await realmSigningKeys(realm.realmId);
  try {
    await verifyJwt(token, { keys, issuer: realm.issuer, audience, typ: 'at+jwt' });
    return true;
  } catch {
    return false;
  }
}

function redeemForm(
  code: string,
  client: Client,
): { payload: string; headers: Record<string, string> } {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', VERIFIER);
  return {
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
    },
  };
}

async function redeemAt(
  realmName: string,
  code: string,
  client: Client,
): Promise<LightMyRequestResponse> {
  const { payload, headers } = redeemForm(code, client);
  return http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload,
    headers,
  });
}

async function refreshAt(
  realmName: string,
  refreshToken: string,
  client: Client,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', refreshToken);
  return http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
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
  await http.register(formbody);
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK }));
  await http.ready();
  httpApp = http;

  realmA = await setupRealm('a');
  realmB = await setupRealm('b');

  // Same client_id and secret registered in both realms, so that a
  // cross-realm redemption attempt authenticates as the client (stage 2)
  // and fails only because the code or refresh token itself is invisible
  // under realm B's RLS context (stage 3) — proving realm isolation, not
  // merely a client lookup failure.
  const clientA = await withRealm(app.db, realmA.realmId, (tx) =>
    insertClient(tx, realmA.realmId, 'shared-app', 'sharedsecret'),
  );
  const clientB = await withRealm(app.db, realmB.realmId, (tx) =>
    insertClient(tx, realmB.realmId, 'shared-app', 'sharedsecret'),
  );
  sharedApp = { a: clientA, b: clientB };

  audienceA = await withRealm(app.db, realmA.realmId, (tx) =>
    insertClient(tx, realmA.realmId, 'app-a', 'app-a-secret', ['https://api-a.example']),
  );
  audienceB = await withRealm(app.db, realmA.realmId, (tx) =>
    insertClient(tx, realmA.realmId, 'app-b', 'app-b-secret', ['https://api-b.example']),
  );
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('audience confusion between clients', () => {
  it('[RFC9068-5-01] refuses an access token minted for another client’s audience', async () => {
    const { accessToken: tokenForA } = await issueTokens(realmA, audienceA, 'openid');
    expect(await verifyAsResourceServer(realmA, tokenForA, 'https://api-a.example')).toBe(true);
    expect(await verifyAsResourceServer(realmA, tokenForA, 'https://api-b.example')).toBe(false);

    const { accessToken: tokenForB } = await issueTokens(realmA, audienceB, 'openid');
    expect(await verifyAsResourceServer(realmA, tokenForB, 'https://api-b.example')).toBe(true);
    expect(await verifyAsResourceServer(realmA, tokenForB, 'https://api-a.example')).toBe(false);
  });

  it('refuses a token whose audience is the client rather than an API', async () => {
    const { idToken } = await issueTokens(realmA, audienceA, 'openid');
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(await verifyAsResourceServer(realmA, idToken, 'https://api-a.example')).toBe(false);
  });
});

describe('[ODUDU-CROSS-REALM-LEAKAGE-01] cross-realm leakage', () => {
  it('cannot redeem realm A code at realm B token endpoint', async () => {
    const code = generateAuthorizationCode();
    const codeHash = hashAuthorizationCode(code);
    await withRealm(app.db, realmA.realmId, async (tx) => {
      await authorizationCodeRepository(tx).create({
        codeHash,
        realmId: realmA.realmId,
        clientId: sharedApp.a.dbId,
        subjectId: realmA.subjectId,
        redirectUri: REDIRECT_URI,
        scope: 'openid',
        nonce: null,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        authTime: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    });

    const atB = await redeemAt(realmB.realmName, code, sharedApp.b);
    expect(atB.statusCode).toBe(400);
    expect(atB.json<{ error: string }>().error).toBe('invalid_grant');

    const atA = await redeemAt(realmA.realmName, code, sharedApp.a);
    expect(atA.statusCode).toBe(200);
  });

  it('cannot use a realm A session to authorize in realm B', async () => {
    // /authorize always renders a fresh challenge regardless of any cookie
    // presented, but that is true today only because no code path reads a
    // session cookie at all — there is no single-sign-on flow yet. Unlike
    // its siblings above, this assertion does not prove cross-realm
    // isolation of anything; it is a regression guard that will start
    // meaning something once a cookie-read path exists at /authorize.
    const res = await http.inject({
      url: authorizeUrl(realmB.realmName, sharedApp.b),
      cookies: { [`${realmA.realmName}-session`]: newId() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('password');
  });

  it('cannot refresh a realm A token at realm B', async () => {
    const { refreshToken } = await issueTokens(realmA, sharedApp.a, 'openid');
    if (refreshToken === undefined) throw new Error('expected a refresh_token');

    const atB = await refreshAt(realmB.realmName, refreshToken, sharedApp.b);
    expect(atB.statusCode).toBe(400);
    expect(atB.json<{ error: string }>().error).toBe('invalid_grant');

    const atA = await refreshAt(realmA.realmName, refreshToken, sharedApp.a);
    expect(atA.statusCode).toBe(200);
  });
});
