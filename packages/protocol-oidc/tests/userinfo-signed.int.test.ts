import { generateSigningKey, signingKeys } from '@odudu/crypto';
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
import { provisionRealm } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
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

let realm: RealmSetup;
let plainClient: Client;
let signingClient: Client;
let noneClient: Client;

function userinfoUrl(realmName: string): string {
  return `/realms/${realmName}/protocol/openid-connect/userinfo`;
}

// Registers a second client in the same realm with a given
// `userinfo_signed_response_alg`, sharing the realm's subject and signing
// key so only the client under test varies between assertions.
async function registerClient(
  clientId: string,
  userinfoSignedResponseAlg: string | null,
): Promise<Client> {
  const dbId = newId();
  await withRealm(app.db, realm.realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(clients).values({
      id: dbId,
      realmId: realm.realmId,
      clientId,
      name: clientId,
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
    });
    await provisionClientDefaults(tx, dbId);
    await clientOidcConfigRepository(tx).create({
      clientId: dbId,
      realmId: realm.realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      userinfoSignedResponseAlg,
    });
  });
  return { clientId, dbId, secret: 'supersecret' };
}

function basicAuth(client: Client): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

async function issueAccessToken(client: Client): Promise<string> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      realmId: realm.realmId,
      clientId: client.dbId,
      subjectId: realm.subjectId,
      redirectUri: REDIRECT_URI,
      scope: 'openid email',
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource: [],
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
  return res.json<{ access_token: string }>().access_token;
}

async function userinfo(client: Client): Promise<LightMyRequestResponse> {
  const accessToken = await issueAccessToken(client);
  return http.inject({
    method: 'GET',
    url: userinfoUrl(realm.realmName),
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

// Decodes a JWT's payload without verifying its signature (or lack of
// one) — used only to inspect what the endpoint produced, never to make a
// trust decision.
function decode(token: Buffer | string): Record<string, unknown> {
  const raw = typeof token === 'string' ? token : token.toString('utf8');
  const segment = raw.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function decodeHeader(token: Buffer | string): Record<string, unknown> {
  const raw = typeof token === 'string' ? token : token.toString('utf8');
  const segment = raw.split('.')[0] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
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
  httpApp = http;

  const realmName = `userinfo-signed-${newId()}`;
  const realmId = newId();

  const { webAppDbId, subjectId } = await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });
    await provisionRealm(tx, realmId);

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({
      subjectId: subject.id,
      realmId,
      username: 'alice',
      email: 'alice@example.com',
      emailVerified: true,
    });

    const dbId = newId();
    await tx.insert(clients).values({
      id: dbId,
      realmId,
      clientId: 'plain-client',
      name: 'Plain client',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
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

    return { webAppDbId: dbId, subjectId: subject.id };
  });

  realm = {
    realmName,
    realmId,
    // light-my-request sends `Host: localhost:80`; the scheme's default
    // port is insignificant and never appears in an issuer
    // (packages/protocol-oidc/src/view/issuer.ts).
    issuer: `http://localhost/realms/${realmName}`,
    client: { clientId: 'plain-client', dbId: webAppDbId, secret: 'supersecret' },
    subjectId,
  };
  plainClient = realm.client;
  signingClient = await registerClient('signing-client', 'RS256');
  noneClient = await registerClient('none-client', 'none');
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('the UserInfo response format follows client registration', () => {
  it('answers JSON for a client that registered no signing algorithm', async () => {
    const response = await userinfo(plainClient);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('answers application/jwt for a client that registered one', async () => {
    const response = await userinfo(signingClient);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/jwt');
  });

  it('[OIDC-CORE-5.3.2-02] signs with iss as the issuer and aud as the client', async () => {
    const response = await userinfo(signingClient);
    const claims = decode(response.rawPayload);
    expect(claims.iss).toBe(realm.issuer);
    expect(claims.aud).toBe(signingClient.clientId);
  });

  // OIDC Core §2 gives an ID Token no `typ`; nothing in JWA or OIDC Core
  // assigns a UserInfo JWT one either, so this pins the header to carry
  // none rather than reusing RFC 9068's `at+jwt`, which names access tokens.
  it('carries no typ header', async () => {
    const response = await userinfo(signingClient);
    const header = decodeHeader(response.rawPayload);
    expect(header.typ).toBeUndefined();
  });

  it('carries the same claims the JSON response would have', async () => {
    const signedRes = await userinfo(signingClient);
    const signed = decode(signedRes.rawPayload);
    const plain = (await userinfo(plainClient)).json<Record<string, unknown>>();
    expect(signed.sub).toBe(plain.sub);
    expect(signed.email).toBe(plain.email);
  });

  // OIDC Core §5.3.2 admits `alg: "none"` for `userinfo_signed_response_alg`
  // and still requires the JWT serialization — it is not the JSON case
  // wearing three dots, so it gets its own assertions rather than reusing
  // the JSON test's.
  it('answers application/jwt, unsigned, for a client that registered none', async () => {
    const response = await userinfo(noneClient);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/jwt');
    const parts = response.body.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe('');
    const claims = decode(response.rawPayload);
    expect(claims.iss).toBe(realm.issuer);
    expect(claims.aud).toBe(noneClient.clientId);
    expect(claims.sub).toBe(realm.subjectId);
  });
});
