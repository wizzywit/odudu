import { generateSigningKey, signJwt, signingKeyRepository, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, users } from '@odudu/domain-identity';
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

const KEK = Buffer.alloc(32, 5);
const REDIRECT_URI = 'https://app.example/callback';

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
  client: Client;
  subjectId: string;
}

let primary: RealmSetup;
let other: RealmSetup;

function userinfoUrl(realm: string): string {
  return `/realms/${realm}/protocol/openid-connect/userinfo`;
}

async function setupRealm(label: string): Promise<RealmSetup> {
  const realmName = `userinfo-${label}-${newId()}`;
  const realmId = newId();

  const clientId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({
      subjectId: subject.id,
      realmId,
      username: `alice-${label}`,
      email: 'alice@example.com',
      emailVerified: true,
    });

    const webAppDbId = newId();
    await tx.insert(clients).values({
      id: webAppDbId,
      realmId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: webAppDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
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

    return { webAppDbId, subjectId: subject.id };
  });

  return {
    realmName,
    realmId,
    issuer: `http://localhost/realms/${realmName}`,
    client: { clientId: 'web-app', dbId: clientId.webAppDbId, secret: 'supersecret' },
    subjectId: clientId.subjectId,
  };
}

function basicAuth(client: Client): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

// Issues an authorization code directly (bypassing /authorize's login UI, as
// the other adversarial suites do) and redeems it through the real /token
// endpoint, returning whatever it issued — an id_token only arrives when
// `scope` includes `openid`.
async function issueTokens(
  realm: RealmSetup,
  scope: string,
): Promise<{ accessToken: string; idToken: string | undefined }> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      realmId: realm.realmId,
      clientId: realm.client.dbId,
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
      authorization: basicAuth(realm.client),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string }>();
  return { accessToken: body.access_token, idToken: body.id_token };
}

async function mintRawAccessToken(
  realm: RealmSetup,
  overrides: {
    iss?: string;
    exp?: number;
    typ?: string;
    scope?: string;
  } = {},
): Promise<string> {
  const key = await withRealm(app.db, realm.realmId, (tx) => signingKeyRepository(tx).active());
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: overrides.iss ?? realm.issuer,
      sub: realm.subjectId,
      aud: [realm.issuer],
      client_id: realm.client.clientId,
      scope: overrides.scope ?? 'openid',
      iat: now,
      exp: overrides.exp ?? now + 300,
      jti: newId(),
    },
    { key, kek: KEK, typ: overrides.typ ?? 'at+jwt' },
  );
}

function tamper(token: string): string {
  const parts = token.split('.');
  const signature = parts[2] ?? '';
  const flipped = signature.startsWith('A') ? 'B' : 'A';
  parts[2] = flipped + signature.slice(1);
  return parts.join('.');
}

async function userinfo(realmName: string, token: string | null): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'GET',
    url: userinfoUrl(realmName),
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
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

  primary = await setupRealm('primary');
  other = await setupRealm('other');
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[RFC6750-3-01] WWW-Authenticate on a request with no credentials', () => {
  it('returns 401 and WWW-Authenticate with no Authorization header, and omits an error code', async () => {
    const res = await userinfo(primary.realmName, null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    // RFC 6750 §3.1: an error code is omitted entirely when the request
    // carried no authentication information at all — distinct from the
    // `error="invalid_token"` a rejected, present token gets below.
    expect(res.headers['www-authenticate']).not.toMatch(/error=/);
  });
});

describe('[RFC6750-3.1-01] 401 invalid_token for a bad, expired or wrong-issuer token', () => {
  it('[RFC9068-4-04] returns 401 invalid_token for an expired token', async () => {
    const expired = await mintRawAccessToken(primary, { exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await userinfo(primary.realmName, expired);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('[RFC9068-4-02] returns 401 invalid_token for a token minted with the wrong issuer', async () => {
    const foreignIssuer = await mintRawAccessToken(primary, {
      iss: 'https://not-this-realm.example',
    });
    const res = await userinfo(primary.realmName, foreignIssuer);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('[RFC9068-4-03] returns 401 invalid_token for a tampered signature', async () => {
    const raw = await mintRawAccessToken(primary);
    const res = await userinfo(primary.realmName, tamper(raw));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('refuses a token minted by another realm', async () => {
    const { accessToken } = await issueTokens(other, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC9068-4-01] rejects a typ other than at+jwt', () => {
  it('refuses an ID token presented as a bearer token', async () => {
    const { idToken } = await issueTokens(primary, 'openid profile email');
    if (idToken === undefined) throw new Error('expected an id_token');
    const res = await userinfo(primary.realmName, idToken);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC6750-2.1-01] accepts the Authorization header, and RFC6750-2.3 accepts no other method', () => {
  it('succeeds when the token is presented in the Authorization header', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
  });

  it('refuses a token in the query string, with no Authorization header at all', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await http.inject({
      method: 'GET',
      url: `${userinfoUrl(primary.realmName)}?access_token=${accessToken}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('[RFC6750-3.1-02] 403 insufficient_scope without the openid scope', () => {
  it('returns 403 and an insufficient_scope challenge', async () => {
    const { accessToken } = await issueTokens(primary, 'profile email');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toMatch(/error="insufficient_scope"/);
  });
});

describe("[OIDC-CORE-5.3.2-01] sub is always present, and an ungranted scope's claims are left out entirely", () => {
  it('omits claims whose scope was not granted', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('sub');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('email_verified');
    expect(body).not.toHaveProperty('name');
  });
});

describe('[OIDC-CORE-5.4-01] claims requested by profile/email are returned from the UserInfo Endpoint', () => {
  it('returns every claim whose scope was granted, as a JSON object', async () => {
    const { accessToken } = await issueTokens(primary, 'openid profile email');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      sub: primary.subjectId,
      name: 'alice-primary',
      email: 'alice@example.com',
      email_verified: true,
    });
  });
});
