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
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

// RFC 8707 §2 at /token: the access token's `aud` is derived from what the
// code (or, on a refresh, the grant it rotated) actually carries, never
// from the client's whole configured `audiences` list — /token may narrow
// what was already resolved and may never widen it. RFC9068-3-03 closes
// the two `deferred: P3b` rows in rfc9068.md this was waiting on.
// RFC8707-2-06 closes rfc8707.md's deferred SHOULD and rfc9068.md's own
// `gap` row for the same requirement.

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

const REDIRECT_URI = 'https://app.example/callback';
const KEK = Buffer.alloc(32, 17);

// RFC 7636 Appendix B's worked example — a single code_challenge is fine to
// reuse, since PKCE only ever binds one code to one redemption.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// Registered on ALL_CLIENT: what an /authorize request naming no `resource`
// resolves onto a code as (resource-authorize.int.test.ts's own
// REGISTERED_AUDIENCES), so a code minted from it is the "codeForAll" case
// — a code whose stored `resource` is the client's whole registered set,
// not an empty one, which is the shape a /token `resource` can narrow.
const REGISTERED_AUDIENCES = ['https://api.example', 'https://reports.example'];

const ALL_CLIENT_ID = 'resource-token-all';
const ALL_CLIENT_SECRET = 'resource-token-all-secret';
const NO_AUDIENCE_CLIENT_ID = 'resource-token-no-audience';
const NO_AUDIENCE_CLIENT_SECRET = 'resource-token-no-audience-secret';
const CC_CLIENT_ID = 'resource-token-cc';
const CC_CLIENT_SECRET = 'resource-token-cc-secret';

let allClientDbId: string;
let noAudienceClientDbId: string;
let subjectId: string;
let ccServiceSubjectId: string;

async function setupRealm(): Promise<void> {
  REALM = `resource-token-${newId()}`;
  REALM_ID = newId();

  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });
    await provisionRealm(tx, REALM_ID);

    allClientDbId = newId();
    await tx.insert(clients).values({
      id: allClientDbId,
      realmId: REALM_ID,
      clientId: ALL_CLIENT_ID,
      name: 'Client registered for two audiences',
      type: 'confidential',
      secretHash: await hashPassword(ALL_CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, allClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: allClientDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: REGISTERED_AUDIENCES,
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    noAudienceClientDbId = newId();
    await tx.insert(clients).values({
      id: noAudienceClientDbId,
      realmId: REALM_ID,
      clientId: NO_AUDIENCE_CLIENT_ID,
      name: 'Client with no registered audience',
      type: 'confidential',
      secretHash: await hashPassword(NO_AUDIENCE_CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, noAudienceClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: noAudienceClientDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const ccServiceSubject = await subjectRepository(tx).create({
      realmId: REALM_ID,
      type: 'service',
    });
    ccServiceSubjectId = ccServiceSubject.id;
    const ccClientDbId = newId();
    await tx.insert(clients).values({
      id: ccClientDbId,
      realmId: REALM_ID,
      clientId: CC_CLIENT_ID,
      name: 'client_credentials client registered for one audience',
      type: 'confidential',
      secretHash: await hashPassword(CC_CLIENT_SECRET),
      serviceSubjectId: ccServiceSubjectId,
    });
    await provisionClientDefaults(tx, ccClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: ccClientDbId,
      realmId: REALM_ID,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: ['https://api.example'],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: [],
    });

    const subject = await subjectRepository(tx).create({ realmId: REALM_ID, type: 'user' });
    subjectId = subject.id;
    await tx.insert(users).values({ subjectId: subject.id, realmId: REALM_ID, username: 'ada' });

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

// Mints an authorization code directly — bypassing /authorize's login UI,
// as access-token.int.test.ts does — with the given stored `resource`,
// which is the one thing under test in this file: what /authorize would
// have resolved onto the code, not what /token is asked to narrow it to.
async function mintCode(clientDbId: string, resource: readonly string[]): Promise<string> {
  const code = generateAuthorizationCode();
  await withRealm(app.db, REALM_ID, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      realmId: REALM_ID,
      clientId: clientDbId,
      subjectId,
      redirectUri: REDIRECT_URI,
      scope: 'openid',
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource,
    });
  });
  return code;
}

interface TokenResult {
  status: number;
  body: { access_token?: string; refresh_token?: string; error?: string };
}

async function post(form: URLSearchParams, clientId: string, secret: string): Promise<TokenResult> {
  const res = await http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
    },
  });
  return { status: res.statusCode, body: res.json<TokenResult['body']>() };
}

async function redeem(
  code: string,
  clientId: string,
  secret: string,
  resource?: string,
): Promise<TokenResult> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  if (resource !== undefined) form.set('resource', resource);
  return post(form, clientId, secret);
}

async function refresh(
  refreshToken: string,
  clientId: string,
  secret: string,
  resource?: string,
): Promise<TokenResult> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  if (resource !== undefined) form.set('resource', resource);
  return post(form, clientId, secret);
}

async function clientCredentials(resource?: string): Promise<TokenResult> {
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (resource !== undefined) form.set('resource', resource);
  return post(form, CC_CLIENT_ID, CC_CLIENT_SECRET);
}

// Decodes without verifying: used only to read what the issuance path
// minted, never to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

// The issuer this token's own `iss` names, read back from the token under
// test rather than reconstructed independently — issuer.ts's own host/port
// canonicalization is exercised elsewhere; what this file asserts is only
// that `aud` carries the issuer alongside whatever `resource` resolved to.
function issuerOf(claims: Record<string, unknown>): string {
  const iss = claims.iss;
  if (typeof iss !== 'string') throw new Error('expected a string iss claim');
  return iss;
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
    }),
  );
  await http.ready();
  httpApp = http;

  await setupRealm();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[RFC9068-3-03] aud derived from resource at /token — authorization_code', () => {
  it('[RFC8707-2-06] mints an access token whose aud is the resource the code carried', async () => {
    const code = await mintCode(allClientDbId, ['https://api.example']);
    const result = await redeem(code, ALL_CLIENT_ID, ALL_CLIENT_SECRET);
    expect(result.status).toBe(200);
    const token = result.body.access_token;
    if (token === undefined) throw new Error('expected an access_token');
    const claims = decode(token);
    expect(claims.aud).toEqual(['https://api.example', issuerOf(claims)]);
  });

  it('[RFC8707-2-06] accepts a resource at /token that narrows the code audience', async () => {
    const code = await mintCode(allClientDbId, REGISTERED_AUDIENCES);
    const result = await redeem(code, ALL_CLIENT_ID, ALL_CLIENT_SECRET, 'https://api.example');
    expect(result.status).toBe(200);
    const token = result.body.access_token;
    if (token === undefined) throw new Error('expected an access_token');
    const claims = decode(token);
    expect(claims.aud).toEqual(['https://api.example', issuerOf(claims)]);
  });

  it('refuses a resource at /token that the code did not carry', async () => {
    const code = await mintCode(allClientDbId, ['https://api.example']);
    const result = await redeem(code, ALL_CLIENT_ID, ALL_CLIENT_SECRET, 'https://reports.example');
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_target');
  });

  // RFC 8707 §2: a single value, so two named at once is a refusal rather
  // than a choice — the same rule `readResourceField` restates from
  // `/authorize`'s own `resourceParam`, exercised here at the door that
  // reuses it.
  it('refuses two resource values at /token, both of which the code carries', async () => {
    const code = await mintCode(allClientDbId, REGISTERED_AUDIENCES);
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    });
    form.append('resource', 'https://api.example');
    form.append('resource', 'https://reports.example');
    const result = await post(form, ALL_CLIENT_ID, ALL_CLIENT_SECRET);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_target');
  });

  // Every client in this repository has `audiences` `[]` today, so every
  // code carries `resource = []` when /authorize resolves none. A rule
  // that refuses on an empty stored value would refuse all of them; this
  // asserts the one such a client actually gets — a token whose aud is
  // the issuer alone.
  it('still mints a token for a client with no registered audience, aud is the issuer alone', async () => {
    const code = await mintCode(noAudienceClientDbId, []);
    const result = await redeem(code, NO_AUDIENCE_CLIENT_ID, NO_AUDIENCE_CLIENT_SECRET);
    expect(result.status).toBe(200);
    const token = result.body.access_token;
    if (token === undefined) throw new Error('expected an access_token');
    const claims = decode(token);
    expect(claims.aud).toEqual([issuerOf(claims)]);
  });
});

describe('[RFC9068-3-03] aud derived from resource at /token — client_credentials', () => {
  it('mints a client_credentials token for the resource asked for', async () => {
    const result = await clientCredentials('https://api.example');
    expect(result.status).toBe(200);
    const token = result.body.access_token;
    if (token === undefined) throw new Error('expected an access_token');
    const claims = decode(token);
    expect(claims.aud).toEqual(['https://api.example', issuerOf(claims)]);
  });

  it('refuses a client_credentials resource the client is not registered for', async () => {
    const result = await clientCredentials('https://reports.example');
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_target');
  });
});

// A refresh that recomputed its audience from `config.audiences`, like
// every other grant's audience once did, would let a client narrow at
// /token with a `resource` and then obtain a wider token on the next
// refresh — the one call site among these where that is a security
// property, not a correctness one, since it defeats "may never widen" in
// one round trip.
describe('[RFC9068-3-03] aud derived from resource at /token — refresh_token', () => {
  it('a refresh preserves the audience the authorization_code redemption narrowed', async () => {
    const code = await mintCode(allClientDbId, REGISTERED_AUDIENCES);
    const redeemed = await redeem(code, ALL_CLIENT_ID, ALL_CLIENT_SECRET, 'https://api.example');
    expect(redeemed.status).toBe(200);
    const refreshToken = redeemed.body.refresh_token;
    if (refreshToken === undefined) throw new Error('expected a refresh_token');

    const refreshed = await refresh(refreshToken, ALL_CLIENT_ID, ALL_CLIENT_SECRET);
    expect(refreshed.status).toBe(200);
    const token = refreshed.body.access_token;
    if (token === undefined) throw new Error('expected an access_token');
    const claims = decode(token);
    expect(claims.aud).toEqual(['https://api.example', issuerOf(claims)]);
  });

  it('a resource on a refresh request cannot widen the audience back', async () => {
    const code = await mintCode(allClientDbId, REGISTERED_AUDIENCES);
    const redeemed = await redeem(code, ALL_CLIENT_ID, ALL_CLIENT_SECRET, 'https://api.example');
    expect(redeemed.status).toBe(200);
    const refreshToken = redeemed.body.refresh_token;
    if (refreshToken === undefined) throw new Error('expected a refresh_token');

    const refreshed = await refresh(
      refreshToken,
      ALL_CLIENT_ID,
      ALL_CLIENT_SECRET,
      'https://reports.example',
    );
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe('invalid_target');
  });
});
