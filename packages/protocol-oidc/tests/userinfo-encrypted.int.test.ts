import { generateSigningKey, signingKeys, verifyJwtAgainstJwkSet } from '@odudu/crypto';
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
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import {
  compactDecrypt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWK,
} from 'jose';
import { Writable } from 'node:stream';
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

const loggedLines: Record<string, unknown>[] = [];
const logStream = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      loggedLines.push(JSON.parse(line) as Record<string, unknown>);
    }
    callback();
  },
});

const KEK = Buffer.alloc(32, 5);
const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const ENC_ALG = 'RSA-OAEP-256';
const ENC_ENC = 'A256GCM';

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

let realm: RealmSetup;
let decryptKey: CryptoKey;
let encryptOnlyClient: Client;
let signAndEncryptClient: Client;
let unreachableJwksClient: Client;
let noCandidateClient: Client;
let ambiguousClient: Client;
let filteredClient: Client;
let signAndEncryptNoCandidateClient: Client;
let disablableClient: Client;

function userinfoUrl(realmName: string): string {
  return `/realms/${realmName}/protocol/openid-connect/userinfo`;
}

interface EncryptionRegistration {
  userinfoSignedResponseAlg?: string | null;
  userinfoEncryptedResponseAlg?: string | null;
  userinfoEncryptedResponseEnc?: string | null;
  jwks?: unknown;
  jwksUri?: string | null;
}

async function registerClient(clientId: string, opts: EncryptionRegistration): Promise<Client> {
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
      userinfoSignedResponseAlg: opts.userinfoSignedResponseAlg ?? null,
      userinfoEncryptedResponseAlg: opts.userinfoEncryptedResponseAlg ?? null,
      userinfoEncryptedResponseEnc: opts.userinfoEncryptedResponseEnc ?? null,
      jwks: opts.jwks ?? null,
      jwksUri: opts.jwksUri ?? null,
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
      claims: { idToken: {}, userinfo: {} },
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

function userinfoWithToken(accessToken: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'GET',
    url: userinfoUrl(realm.realmName),
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

async function userinfo(client: Client): Promise<LightMyRequestResponse> {
  const accessToken = await issueAccessToken(client);
  return userinfoWithToken(accessToken);
}

// The access token this server issues carries no opinion on whether its
// client stays enabled — disabling one is a live operator action against a
// client that may already hold tokens with time left on them.
async function disableClient(client: Client): Promise<void> {
  await withRealm(app.db, realm.realmId, (tx) =>
    tx.update(clients).set({ enabled: false }).where(eq(clients.id, client.dbId)),
  );
}

function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function protectedHeaderOf(jwe: string): Record<string, unknown> {
  return decodeProtectedHeader(jwe);
}

async function decrypt(jwe: string): Promise<string> {
  const { plaintext } = await compactDecrypt(jwe, decryptKey);
  return new TextDecoder().decode(plaintext);
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

  http = Fastify({ logger: { level: 'warn', stream: logStream } });
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      // Every client below carries its keys inline (`jwks`), except
      // unreachableJwksClient, which registers a `jwks_uri` this fetcher
      // always refuses — no fake key server needed to prove a dead
      // jwks_uri reaches the same refusal as an unselectable key.
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;

  const { publicKey, privateKey } = await generateKeyPair(ENC_ALG, { extractable: true });
  decryptKey = privateKey;
  const encPublicJwk: JWK = { ...(await exportJWK(publicKey)), use: 'enc' };

  const realmName = `userinfo-encrypted-${newId()}`;
  const realmId = newId();

  const subjectId = await withRealm(app.db, realmId, async (tx) => {
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

  realm = {
    realmName,
    realmId,
    // light-my-request sends `Host: localhost:80`; the scheme's default
    // port is insignificant and never appears in an issuer
    // (packages/protocol-oidc/src/view/issuer.ts).
    issuer: `http://localhost/realms/${realmName}`,
    subjectId,
  };

  encryptOnlyClient = await registerClient('encrypt-only-client', {
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [encPublicJwk] },
  });
  signAndEncryptClient = await registerClient('sign-and-encrypt-client', {
    userinfoSignedResponseAlg: 'RS256',
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [encPublicJwk] },
  });
  unreachableJwksClient = await registerClient('unreachable-jwks-client', {
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwksUri: 'https://key-server.invalid/jwks.json',
  });
  // No candidate at all: an empty key set, distinct from one the filters
  // reduce to zero (filteredClient, below).
  noCandidateClient = await registerClient('no-candidate-client', {
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [] },
  });
  // Two keys, both `use: 'enc'`, silent on `alg` — nothing breaks the tie.
  const second = await generateKeyPair(ENC_ALG, { extractable: true });
  const secondPublicJwk: JWK = { ...(await exportJWK(second.publicKey)), use: 'enc' };
  ambiguousClient = await registerClient('ambiguous-client', {
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [encPublicJwk, secondPublicJwk] },
  });
  // A candidate `use: 'enc'` key, but its `kty` (EC) cannot serve the
  // registered `alg` family (RSA-OAEP-256 needs `kty: 'RSA'`).
  const { publicKey: ecPublicKey } = await generateKeyPair('ES256', { extractable: true });
  filteredClient = await registerClient('filtered-client', {
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [{ ...(await exportJWK(ecPublicKey)), use: 'enc' }] },
  });
  // Registers both: a fallback that answered with the signed-but-unencrypted
  // form on failure (rather than refusing) would pass every other test in
  // this file, since every other failing client registered encryption alone.
  signAndEncryptNoCandidateClient = await registerClient('sign-and-encrypt-no-candidate-client', {
    userinfoSignedResponseAlg: 'RS256',
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [] },
  });
  disablableClient = await registerClient('disablable-client', {
    userinfoEncryptedResponseAlg: ENC_ALG,
    userinfoEncryptedResponseEnc: ENC_ENC,
    jwks: { keys: [encPublicJwk] },
  });
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[OIDC-CORE-5.3.2-03] the UserInfo response is encrypted without also being signed', () => {
  it('encrypts without signing when only encryption was registered', async () => {
    const response = await userinfo(encryptOnlyClient);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/jwt');

    const plaintext = await decrypt(response.body);
    const claims = JSON.parse(plaintext) as Record<string, unknown>;
    expect(claims.sub).toBe(realm.subjectId);
    // Not a JWT: no iss/aud were ever added, because nothing signed this.
    expect(claims.iss).toBeUndefined();
  });

  it('carries no cty, since the encrypted plaintext is not a nested JWT', async () => {
    const response = await userinfo(encryptOnlyClient);
    expect(protectedHeaderOf(response.body).cty).toBeUndefined();
  });
});

describe('[OIDC-CORE-5.3.2-04] signing and encryption together produce a Nested JWT, sign then encrypt', () => {
  it('signs then encrypts when both were registered, producing a nested JWT', async () => {
    const response = await userinfo(signAndEncryptClient);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/jwt');
    expect(protectedHeaderOf(response.body).cty).toBe('JWT');

    const inner = await decrypt(response.body);
    // Pins the order, not merely `cty`: the decrypted plaintext is itself
    // parsed and its signature verified against the realm's own published
    // JWKS. A JWE wrapping raw JSON with a `cty: "JWT"` header slapped on
    // by mistake would fail this — jose refuses a three-dot string that
    // does not verify — where checking `cty` alone would not catch it.
    const certsRes = await http.inject({
      method: 'GET',
      url: `/realms/${realm.realmName}/protocol/openid-connect/certs`,
    });
    const jwks: unknown = certsRes.json();
    const verified = await verifyJwtAgainstJwkSet(inner, jwks, {
      issuer: realm.issuer,
      audience: signAndEncryptClient.clientId,
      now: new Date(),
    });
    expect(verified).toBe(true);

    const claims = decode(inner);
    expect(claims.iss).toBe(realm.issuer);
    expect(claims.sub).toBe(realm.subjectId);
  });
});

describe('[OIDC-CORE-5.3.2-03] a client asking for encryption never receives clear text', () => {
  it('fails the request rather than falling back to JSON when the key cannot be retrieved', async () => {
    const response = await userinfo(unreachableJwksClient);
    expect(response.statusCode).toBe(500);
    // Not merely "no subjectId" — no body at all, so nothing the JSON form
    // would have carried (sub, email, any other claim) leaks either.
    expect(response.body).toBe('');
  });

  it('logs the reason for an operator, without a WWW-Authenticate challenge', async () => {
    loggedLines.length = 0;
    const response = await userinfo(unreachableJwksClient);
    expect(response.statusCode).toBe(500);
    expect(response.headers['www-authenticate']).toBeUndefined();
    const warning = loggedLines.find(
      (line) => line.msg === 'userinfo: could not encrypt the response for the registered client',
    );
    expect(warning).toMatchObject({ client_id: unreachableJwksClient.clientId });
  });

  // A disabled registrant's token is live for its own TTL, so this is
  // reachable with a live token, not only a dead one.
  it('refuses rather than answering in clear text once its client is disabled', async () => {
    const accessToken = await issueAccessToken(disablableClient);
    await disableClient(disablableClient);
    const response = await userinfoWithToken(accessToken);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('');
  });
});

describe('three different key-selection failures reach the same refusal as a dead jwks_uri', () => {
  it('refuses when the JWKS has no candidate key for the registered alg', async () => {
    const response = await userinfo(noCandidateClient);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('');
  });

  it('refuses when two candidates are equally good and nothing breaks the tie', async () => {
    const response = await userinfo(ambiguousClient);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('');
  });

  it("refuses when the only candidate's kty cannot serve the registered alg family", async () => {
    const response = await userinfo(filteredClient);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('');
  });

  // A fallback to the pre-encryption form would emit a readable JWS here,
  // not JSON — a different leak than the encrypt-only clients above catch.
  it('refuses the same way when the client also registered signing', async () => {
    const response = await userinfo(signAndEncryptNoCandidateClient);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('');
  });
});
