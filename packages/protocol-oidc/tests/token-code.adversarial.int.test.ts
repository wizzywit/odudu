import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { generateSigningKey, signJwt, signingKeys, type SigningKeyRecord } from '@odudu/crypto';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
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
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository, consumeAuthorizationCode } from '#/repository/codes';
import { authorizationCodes } from '#/schema/authorization-codes';
import { tokenGrants } from '#/schema/token-grants';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

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
const SECOND_REGISTERED_URI = 'https://app.example/other-callback';
const AUDIENCE = 'https://api.example';
const NONCE = 'n-9f2';
const KEK = Buffer.alloc(32, 3);

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Client {
  clientId: string;
  dbId: string;
  secret: string | null;
}

let webApp: Client;
let otherApp: Client;
let spa: Client;
let postApp: Client;
let refreshApp: Client;
let subjectId: string;

async function setupTokenRealm(): Promise<void> {
  REALM = `token-adversarial-${newId()}`;
  REALM_ID = newId();

  await withRealm(app.db, REALM_ID, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: REALM_ID, name: REALM });

    const subject = await subjectRepository(tx).create({ realmId: REALM_ID, type: 'user' });
    subjectId = subject.id;

    const webAppDbId = newId();
    await tx.insert(clients).values({
      id: webAppDbId,
      realmId: REALM_ID,
      clientId: 'web-app',
      name: 'Web app',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: webAppDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI, SECOND_REGISTERED_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    webApp = { clientId: 'web-app', dbId: webAppDbId, secret: 'supersecret' };

    const otherAppDbId = newId();
    await tx.insert(clients).values({
      id: otherAppDbId,
      realmId: REALM_ID,
      clientId: 'other-app',
      name: 'Other app',
      type: 'confidential',
      secretHash: await hashPassword('othersecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: otherAppDbId,
      realmId: REALM_ID,
      redirectUris: ['https://other.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    otherApp = { clientId: 'other-app', dbId: otherAppDbId, secret: 'othersecret' };

    const spaDbId = newId();
    await tx.insert(clients).values({
      id: spaDbId,
      realmId: REALM_ID,
      clientId: 'spa',
      name: 'Public SPA',
      type: 'public',
      secretHash: null,
    });
    await clientOidcConfigRepository(tx).create({
      clientId: spaDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    spa = { clientId: 'spa', dbId: spaDbId, secret: null };

    const postAppDbId = newId();
    await tx.insert(clients).values({
      id: postAppDbId,
      realmId: REALM_ID,
      clientId: 'post-app',
      name: 'client_secret_post app',
      type: 'confidential',
      secretHash: await hashPassword('postsecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: postAppDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    postApp = { clientId: 'post-app', dbId: postAppDbId, secret: 'postsecret' };

    const refreshAppDbId = newId();
    await tx.insert(clients).values({
      id: refreshAppDbId,
      realmId: REALM_ID,
      clientId: 'refresh-app',
      name: 'Refresh-capable app',
      type: 'confidential',
      secretHash: await hashPassword('refreshsecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: refreshAppDbId,
      realmId: REALM_ID,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    refreshApp = { clientId: 'refresh-app', dbId: refreshAppDbId, secret: 'refreshsecret' };

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

interface IssueCodeOptions {
  client?: Client;
  redirectUri?: string;
  scope?: string;
  nonce?: string | null;
  codeChallenge?: string;
  authTimeOffsetMs?: number;
  ttlMs?: number;
  consumedImmediately?: boolean;
}

async function issueCode(opts: IssueCodeOptions = {}): Promise<{ code: string; codeHash: string }> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);
  const client = opts.client ?? webApp;
  const authTime = new Date(Date.now() + (opts.authTimeOffsetMs ?? 0));
  const expiresAt = new Date(authTime.getTime() + (opts.ttlMs ?? 60_000));

  await withRealm(app.db, REALM_ID, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      realmId: REALM_ID,
      clientId: client.dbId,
      subjectId,
      redirectUri: opts.redirectUri ?? REDIRECT_URI,
      scope: opts.scope ?? 'openid profile',
      nonce: opts.nonce === undefined ? NONCE : opts.nonce,
      codeChallenge: opts.codeChallenge ?? CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime,
      expiresAt,
    });
    if (opts.consumedImmediately === true) {
      await authorizationCodeRepository(tx).consume(codeHash);
    }
  });

  return { code, codeHash };
}

interface RedeemOptions {
  as?: Client;
  // The Basic-auth secret. `undefined` (default) uses the client's own
  // secret; `null` suppresses the Authorization header entirely.
  secret?: string | null;
  // A client_secret_post value to put in the form body alongside
  // client_id. Independent of `secret`, so a test can request both at once
  // (to prove the "no more than one method" rejection) or the body value
  // alone (to prove client_secret_post's accept path).
  bodySecret?: string;
  verifier?: string | null;
  redirectUri?: string;
  // Finding 1: omits every way of identifying the client — no Authorization
  // header, no client_id, no client_secret anywhere in the request.
  omitClientId?: boolean;
}

async function redeem(code: string, opts: RedeemOptions = {}): Promise<LightMyRequestResponse> {
  const client = opts.as ?? webApp;

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', opts.redirectUri ?? REDIRECT_URI);
  if (opts.verifier !== null) form.set('code_verifier', opts.verifier ?? VERIFIER);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };

  if (opts.omitClientId !== true) {
    const basicSecret =
      opts.secret === null ? undefined : (opts.secret ?? client.secret ?? undefined);
    const bodySecret = opts.bodySecret;
    const usingBasic = basicSecret !== undefined;
    const usingBodySecret = bodySecret !== undefined;

    if (usingBasic) {
      const basic = Buffer.from(`${client.clientId}:${basicSecret}`).toString('base64');
      headers.authorization = `Basic ${basic}`;
    }
    if (bodySecret !== undefined) {
      form.set('client_secret', bodySecret);
    }
    if (!usingBasic || usingBodySecret) {
      form.set('client_id', client.clientId);
    }
  }

  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers,
  });
}

function tokenUrl(): string {
  return `/realms/${REALM}/protocol/openid-connect/token`;
}

function basicHeader(client: Client): Record<string, string> {
  if (client.secret === null) return {};
  const encoded = Buffer.from(`${client.clientId}:${client.secret}`).toString('base64');
  return { authorization: `Basic ${encoded}` };
}

// Posts a form body built from ordered pairs rather than an object, so a
// parameter can be sent twice, omitted, or sent with no value — none of
// which a `Record` can express.
async function postForm(
  params: [string, string][],
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const body = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return http.inject({
    method: 'POST',
    url: tokenUrl(),
    payload: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
}

function redemptionParams(code: string, redirectUri: string = REDIRECT_URI): [string, string][] {
  return [
    ['grant_type', 'authorization_code'],
    ['code', code],
    ['redirect_uri', redirectUri],
    ['code_verifier', VERIFIER],
  ];
}

function without(params: [string, string][], key: string): [string, string][] {
  return params.filter(([name]) => name !== key);
}

async function refreshWith(refreshToken: string, client: Client): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', refreshToken);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (client.secret !== null) {
    headers.authorization = `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
  }

  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers,
  });
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function decodeHeader(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[0];
  if (segment === undefined) throw new Error('expected a JWT header segment');
  return decodeSegment(segment);
}

function decodePayload(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT payload segment');
  return decodeSegment(segment);
}

async function grantIdForCode(codeHash: string): Promise<string | null> {
  const rows = await owner.db
    .select({ grantId: authorizationCodes.grantId })
    .from(authorizationCodes)
    .where(eq(authorizationCodes.codeHash, codeHash));
  return rows[0]?.grantId ?? null;
}

async function grantRevokedAt(grantId: string): Promise<Date | null> {
  const rows = await owner.db
    .select({ revokedAt: tokenGrants.revokedAt })
    .from(tokenGrants)
    .where(eq(tokenGrants.id, grantId));
  return rows[0]?.revokedAt ?? null;
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

  await setupTokenRealm();

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

describe('[RFC6749-4.1.4-01] a successful redemption', () => {
  it('returns access_token, id_token, token_type and expires_in', async () => {
    const { code } = await issueCode();
    const res = await redeem(code);
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      access_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>();
    expect(body.access_token).toBeTruthy();
    expect(body.id_token).toBeTruthy();
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(300);
    expect(body.scope).toBe('openid profile');
  });
});

describe('[RFC6749-4.1.2-02] authorization code replay', () => {
  it('rejects the second redemption', async () => {
    const { code } = await issueCode();
    expect((await redeem(code)).statusCode).toBe(200);
    const second = await redeem(code);
    expect(second.statusCode).toBe(400);
    expect(second.json<{ error: string }>().error).toBe('invalid_grant');
  });

  // Proves the grant row is revoked, not merely the refresh token's own
  // `used_at`/expiry columns — a necessary but not sufficient condition for
  // the clause below, which is why it carries no RFC bracket id of its own.
  it('revokes the grant issued by the first redemption', async () => {
    const { code, codeHash } = await issueCode();
    const first = await redeem(code);
    expect(first.statusCode).toBe(200);

    await redeem(code);

    const grantId = await grantIdForCode(codeHash);
    expect(grantId).toBeTruthy();
    if (grantId === null) throw new Error('expected the first redemption to have a grant');
    expect(await grantRevokedAt(grantId)).not.toBeNull();
  });

  // The end-to-end proof RFC 6749 §4.1.2 actually asks for: not just that
  // the grant row carries a `revoked_at`, but that a refresh token issued
  // from the replayed code is genuinely unusable afterward.
  it('[RFC6749-4.1.2-04] rejects the refresh token issued by the first redemption once the code is replayed', async () => {
    const { code } = await issueCode({ client: refreshApp });
    const first = await redeem(code, { as: refreshApp });
    expect(first.statusCode).toBe(200);
    const { refresh_token: refreshToken } = first.json<{ refresh_token?: string }>();
    if (refreshToken === undefined)
      throw new Error('expected the first redemption to issue a refresh token');

    const replay = await redeem(code, { as: refreshApp });
    expect(replay.statusCode).toBe(400);

    const refreshAttempt = await refreshWith(refreshToken, refreshApp);
    expect(refreshAttempt.statusCode).toBe(400);
    expect(refreshAttempt.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

describe('authorization_code issuance for a client without the refresh_token grant', () => {
  it('carries no refresh_token field in the token response', async () => {
    const { code } = await issueCode();
    const res = await redeem(code);
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect('refresh_token' in body).toBe(false);
  });
});

describe('[RFC6749-4.1.3-01] code substitution across clients', () => {
  it('refuses a code issued to another client', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { as: otherApp });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

describe('[RFC7636-4.6-02] PKCE at the token endpoint', () => {
  it('refuses a wrong code_verifier', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { verifier: 'x'.repeat(43) });
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('[RFC7636-4.5-01] refuses a missing code_verifier', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { verifier: null });
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

describe('[RFC6749-4.1.3-02] redirect_uri must match the one bound to the code', () => {
  it('refuses a different registered redirect_uri', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { redirectUri: SECOND_REGISTERED_URI });
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

describe('[RFC6749-5.2-01] failures are not an oracle', () => {
  it('returns the same error for every distinct code failure', async () => {
    const expired = await issueCode({ authTimeOffsetMs: -120_000, ttlMs: 60_000 });
    const consumed = await issueCode({ consumedImmediately: true });
    const wrongClient = await issueCode();
    const wrongVerifier = await issueCode();

    const errors = await Promise.all(
      [
        redeem('nonexistent'),
        redeem(expired.code),
        redeem(consumed.code),
        redeem(wrongClient.code, { as: otherApp }),
        redeem(wrongVerifier.code, { verifier: 'wrong'.repeat(10) }),
      ].map(async (p) => (await p).json<{ error: string }>().error),
    );

    expect(new Set(errors)).toEqual(new Set(['invalid_grant']));
  });
});

describe('[RFC9068-2.2-01] the access token is a typed JWT', () => {
  it('carries typ at+jwt and every required claim', async () => {
    const { code } = await issueCode();
    const { access_token: accessToken } = (await redeem(code)).json<{ access_token: string }>();
    const header = decodeHeader(accessToken);
    const payload = decodePayload(accessToken);

    expect(header).toMatchObject({ typ: 'at+jwt', alg: 'RS256' });
    expect(header.kid).toBeTruthy();
    for (const claim of ['iss', 'exp', 'aud', 'sub', 'client_id', 'iat', 'jti']) {
      expect(payload[claim]).toBeDefined();
    }
  });

  it('does not put typ at+jwt on the id token', async () => {
    const { code } = await issueCode();
    const { id_token: idToken } = (await redeem(code)).json<{ id_token: string }>();
    expect(decodeHeader(idToken).typ).not.toBe('at+jwt');
  });
});

describe('[OIDC-CORE-3.1.3.7-01] the id token binds to the request', () => {
  it('carries the nonce from the authorization request', async () => {
    const { code } = await issueCode();
    const { id_token: idToken } = (await redeem(code)).json<{ id_token: string }>();
    expect(decodePayload(idToken).nonce).toBe(NONCE);
  });

  it('has the client as its audience, not the API', async () => {
    const { code } = await issueCode();
    const { id_token: idToken } = (await redeem(code)).json<{ id_token: string }>();
    expect(decodePayload(idToken).aud).toBe('web-app');
  });
});

describe('client authentication', () => {
  it('[RFC6749-5.2-02] returns 401 and WWW-Authenticate for a bad secret', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { secret: 'wrong' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('refuses a public client that presents a secret', async () => {
    const { code } = await issueCode({ client: spa });
    const res = await redeem(code, { as: spa, secret: 'anything' });
    expect(res.statusCode).toBe(401);
  });

  it('[RFC6749-3.2.1-01] refuses a confidential client that omits credentials entirely', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { omitClientId: true });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });
});

describe('client_secret_post (RFC 6749 §2.3.1)', () => {
  it('[RFC6749-2.3.1-01] accepts a client configured for client_secret_post presenting its secret in the body', async () => {
    const { code } = await issueCode({ client: postApp });
    const res = await redeem(code, { as: postApp, secret: null, bodySecret: postApp.secret ?? '' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a client_secret_post client that instead authenticates over Basic', async () => {
    const { code } = await issueCode({ client: postApp });
    const res = await redeem(code, { as: postApp });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('refuses a client_secret_basic client presenting client_secret in the body', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { secret: null, bodySecret: webApp.secret ?? '' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('[RFC6749-2.3-01] refuses a request presenting both a Basic header and a body client_secret', async () => {
    const { code } = await issueCode();
    const res = await redeem(code, { bodySecret: webApp.secret ?? '' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });
});

describe('[RFC6749-5.1-01] token responses are not cached', () => {
  it('sets Cache-Control: no-store and Pragma: no-cache', async () => {
    const { code } = await issueCode();
    const res = await redeem(code);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers.pragma).toBe('no-cache');
  });
});

describe('atomic code consumption', () => {
  it('[RFC6749-4.1.2-01] only one of two concurrent redemptions succeeds', async () => {
    const { codeHash } = await issueCode();

    const results = await Promise.allSettled([
      withRealm(app.db, REALM_ID, async (tx) => consumeAuthorizationCode(tx, codeHash)),
      withRealm(app.db, REALM_ID, async (tx) => consumeAuthorizationCode(tx, codeHash)),
    ]);

    const consumed = results.filter((r) => r.status === 'fulfilled' && r.value !== null);
    expect(consumed).toHaveLength(1);
  });
});

// Every test below pairs the assertion with the request that differs from
// it in exactly one way and succeeds. Without that pair a 400 proves only
// that something was wrong with the request — a mistyped URL answers 404
// and a stale realm answers 404 just as readily as the rule under test.
describe('[RFC6749-3.2-01] the token endpoint is POST-only', () => {
  it('answers POST at the URL that every other method is refused at', async () => {
    const { code } = await issueCode();
    const posted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(posted.statusCode).toBe(200);

    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await http.inject({ method, url: tokenUrl(), headers: basicHeader(webApp) });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('[RFC6749-3.2-02] unrecognized token request parameters', () => {
  it('redeems a code that arrives alongside parameters the endpoint knows nothing about', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [
        ...redemptionParams(code),
        ['audience', 'https://elsewhere.example'],
        ['resource', 'urn:example:api'],
        ['assertion', 'not-a-parameter-of-this-grant'],
      ],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(200);

    // The control for "ignored": the endpoint is reading this body rather
    // than waving every body through, so the 200 above is the extra
    // parameters being dropped and not the request going unexamined.
    const { code: second } = await issueCode();
    const tampered = await postForm(
      redemptionParams(second, SECOND_REGISTERED_URI),
      basicHeader(webApp),
    );
    expect(tampered.statusCode).toBe(400);
  });
});

describe('[RFC6749-3.2-03] a parameter included more than once', () => {
  it('refuses a redemption repeating grant_type, with the identical value', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [...redemptionParams(code), ['grant_type', 'authorization_code']],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');

    // The same code, sent once, still redeems: duplication is the whole of
    // the difference, and the refusal consumed nothing.
    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });

  it('refuses a redemption repeating code, with the identical value', async () => {
    const { code } = await issueCode();
    const res = await postForm([...redemptionParams(code), ['code', code]], basicHeader(webApp));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');

    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });
});

// §3.2's rule is about every parameter of the request, and the ones that
// carry it least visibly are the optional ones: a required parameter read as
// empty and a required parameter read as absent both fail the same way, so
// they cannot tell the two readings apart. `client_secret` can. An empty one
// used to count as a second authentication method under RFC 6749 §2.3.1's
// one-method-per-request rule, refusing a request that succeeds with the
// parameter left out.
describe('[RFC6749-3.2-04] a token request parameter sent with no value', () => {
  it('redeems a code presented with an empty client_secret beside the Basic header', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [...redemptionParams(code), ['client_secret', '']],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(200);
  });

  it('refuses the same redemption once that client_secret carries any value', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [...redemptionParams(code), ['client_secret', webApp.secret ?? '']],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('reads an empty client_id as a client that named itself not at all', async () => {
    const { code } = await issueCode({ client: spa });
    const empty = await postForm([...redemptionParams(code), ['client_id', '']]);
    expect(empty.statusCode).toBe(401);
    expect(empty.json<{ error: string }>().error).toBe('invalid_client');

    // The same code still redeems, which is what makes the refusal above
    // about the empty value rather than about a spent code.
    const named = await postForm([...redemptionParams(code), ['client_id', spa.clientId]]);
    expect(named.statusCode).toBe(200);
  });

  it('reads an empty required parameter as absent', async () => {
    const { code } = await issueCode();
    for (const key of ['grant_type', 'code', 'redirect_uri']) {
      const res = await postForm(
        [...without(redemptionParams(code), key), [key, '']],
        basicHeader(webApp),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_request');
    }

    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });
});

describe('[RFC6749-3.2.1-02] a client that does not authenticate identifies itself with client_id', () => {
  it('redeems for a public client that sends client_id', async () => {
    const { code } = await issueCode({ client: spa });
    const res = await postForm([...redemptionParams(code), ['client_id', spa.clientId]]);
    expect(res.statusCode).toBe(200);
  });

  it('refuses the same redemption with client_id omitted', async () => {
    const { code } = await issueCode({ client: spa });
    const res = await postForm(redemptionParams(code));
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });
});

describe('[RFC6749-4.1.3-03] grant_type on the access token request', () => {
  it('refuses a redemption that omits grant_type', async () => {
    const { code } = await issueCode();
    const res = await postForm(without(redemptionParams(code), 'grant_type'), basicHeader(webApp));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');

    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });

  it('refuses an unregistered grant_type value', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [
        ['grant_type', 'urn:example:invented-grant'],
        ...without(redemptionParams(code), 'grant_type'),
      ],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('unsupported_grant_type');
  });

  it('does not redeem a code presented under another registered grant_type', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [['grant_type', 'client_credentials'], ...without(redemptionParams(code), 'grant_type')],
      basicHeader(webApp),
    );
    expect(res.statusCode).not.toBe(200);

    // The code survived the attempt untouched, which is what "that request
    // was not an authorization_code redemption" means in practice.
    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });
});

describe('[RFC6749-4.1.3-04] code on the access token request', () => {
  it('refuses a redemption that omits code', async () => {
    const { code } = await issueCode();
    const res = await postForm(without(redemptionParams(code), 'code'), basicHeader(webApp));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');

    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });
});

describe('[RFC6749-4.1.3-05] redirect_uri on the access token request', () => {
  it('refuses a redemption that omits redirect_uri', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      without(redemptionParams(code), 'redirect_uri'),
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');

    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });

  it('refuses a redirect_uri that is registered but is not the one the code was obtained with', async () => {
    const { code } = await issueCode({ redirectUri: REDIRECT_URI });
    const res = await postForm(redemptionParams(code, SECOND_REGISTERED_URI), basicHeader(webApp));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('redeems a code obtained with the second registered redirect_uri when that same value is presented', async () => {
    const { code } = await issueCode({ redirectUri: SECOND_REGISTERED_URI });
    const res = await postForm(redemptionParams(code, SECOND_REGISTERED_URI), basicHeader(webApp));
    expect(res.statusCode).toBe(200);
  });
});

describe('[RFC6749-5.1-02] the members of a successful token response', () => {
  it('carries access_token, token_type, expires_in, and the issued scope the request never named', async () => {
    const { code } = await issueCode({ scope: 'openid profile' });
    const params = redemptionParams(code);
    expect(params.some(([name]) => name === 'scope')).toBe(false);

    const res = await postForm(params, basicHeader(webApp));
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    expect(typeof body.access_token).toBe('string');
    expect(body.access_token).not.toBe('');
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.expires_in).toBe('number');
    // The request asked for no scope at all, so what was issued cannot be
    // identical to what was requested, and §5.1 requires saying so.
    expect(body.scope).toBe('openid profile');
  });
});

describe('[RFC6749-5.2-03] the members of a token error response', () => {
  it('carries error and nothing else, on every distinct failure', async () => {
    const unknownCode = await postForm(redemptionParams('nonexistent'), basicHeader(webApp));
    const badSecret = await postForm(redemptionParams((await issueCode()).code), {
      authorization: `Basic ${Buffer.from(`${webApp.clientId}:wrong`).toString('base64')}`,
    });
    const malformed = await postForm(
      without(redemptionParams((await issueCode()).code), 'code'),
      basicHeader(webApp),
    );
    const unsupported = await postForm([['grant_type', 'urn:example:nope']], basicHeader(webApp));

    for (const res of [unknownCode, badSecret, malformed, unsupported]) {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(Object.keys(res.json<Record<string, unknown>>())).toEqual(['error']);
    }
  });
});

describe('[RFC6749-10.5-01] authorization codes are short-lived and single-use', () => {
  it('refuses a code past its expiry, and a second redemption of a live one', async () => {
    const expired = await issueCode({ authTimeOffsetMs: -120_000, ttlMs: 60_000 });
    const refusedForAge = await postForm(redemptionParams(expired.code), basicHeader(webApp));
    expect(refusedForAge.statusCode).toBe(400);
    expect(refusedForAge.json<{ error: string }>().error).toBe('invalid_grant');

    // Identical in every respect but the expiry window, which is what makes
    // the refusal above about age rather than about anything else.
    const live = await issueCode({ ttlMs: 60_000 });
    expect((await postForm(redemptionParams(live.code), basicHeader(webApp))).statusCode).toBe(200);

    const second = await postForm(redemptionParams(live.code), basicHeader(webApp));
    expect(second.statusCode).toBe(400);
    expect(second.json<{ error: string }>().error).toBe('invalid_grant');
  });
});

describe('[RFC6749-10.5-02] an authenticable client is authenticated and the code confirmed as its own', () => {
  it('refuses a wrong secret, refuses a code belonging to another client, and redeems for the client the code was issued to', async () => {
    const { code } = await issueCode();

    const wrongSecret = await postForm(redemptionParams(code), {
      authorization: `Basic ${Buffer.from(`${webApp.clientId}:wrong`).toString('base64')}`,
    });
    expect(wrongSecret.statusCode).toBe(401);
    expect(wrongSecret.json<{ error: string }>().error).toBe('invalid_client');

    // otherApp authenticates perfectly well; the code is simply not its.
    const foreign = await issueCode();
    const substituted = await postForm(redemptionParams(foreign.code), basicHeader(otherApp));
    expect(substituted.statusCode).toBe(400);
    expect(substituted.json<{ error: string }>().error).toBe('invalid_grant');

    const accepted = await postForm(redemptionParams(code), basicHeader(webApp));
    expect(accepted.statusCode).toBe(200);
  });
});

// OIDC Discovery §3 and §4.3 make the issuer identifier one string: what
// the document says, what the URL the document was fetched from prefixes,
// and what a redeemed ID Token puts in `iss`. An absolute URL is written
// out here rather than a path, because light-my-request derives the Host
// header from it — so the well-known URL these assertions compare against
// is the one the request actually carried, not one reassembled afterwards.
const WELL_KNOWN_SUFFIX = '/.well-known/openid-configuration';

function wellKnownUrl(): string {
  return `http://localhost/realms/${REALM}${WELL_KNOWN_SUFFIX}`;
}

async function discoveryDocumentOf(): Promise<Record<string, unknown>> {
  const res = await http.inject({ url: wellKnownUrl() });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

async function discoveryIssuer(): Promise<unknown> {
  return (await discoveryDocumentOf()).issuer;
}

async function redeemedIdToken(): Promise<string> {
  const { code } = await issueCode();
  const res = await redeem(code);
  expect(res.statusCode).toBe(200);
  const { id_token: idToken } = res.json<{ id_token?: string }>();
  if (idToken === undefined) throw new Error('expected an id_token');
  return idToken;
}

async function redeemedAccessToken(opts: IssueCodeOptions = {}): Promise<string> {
  const { code } = await issueCode(opts);
  const res = await redeem(code);
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

describe('the issuer identifier is one string wherever it appears', () => {
  it('[OIDC-DISCOVERY-3-02] is byte-identical to the iss of an ID Token from the same realm', async () => {
    const issuer = await discoveryIssuer();
    expect(typeof issuer).toBe('string');
    expect(decodePayload(await redeemedIdToken()).iss).toBe(issuer);
  });

  it('[OIDC-DISCOVERY-4.3-01] is the exact prefix of the URL it was fetched from, and the ID Token iss', async () => {
    const issuer = await discoveryIssuer();
    expect(`${String(issuer)}${WELL_KNOWN_SUFFIX}`).toBe(wellKnownUrl());
    expect(decodePayload(await redeemedIdToken()).iss).toBe(issuer);
  });
});

async function publishedJwk(kid: string): Promise<JsonWebKey> {
  const res = await http.inject({ url: `/realms/${REALM}/protocol/openid-connect/certs` });
  expect(res.statusCode).toBe(200);
  const { keys } = res.json<{ keys: (JsonWebKey & { kid?: string })[] }>();
  const jwk = keys.find((candidate) => candidate.kid === kid);
  if (jwk === undefined) throw new Error(`the realm publishes no key ${kid}`);
  return jwk;
}

// RS256 is RSASSA-PKCS1-v1_5 over SHA-256 of the signing input. Checked
// with node's own primitives rather than the library that produced the
// signature, so the assertion does not reduce to that library agreeing
// with itself.
function rs256SignatureIsValid(token: string, jwk: JsonWebKey): boolean {
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined) return false;
  return verify(
    'sha256',
    Buffer.from(`${header}.${payload}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url'),
  );
}

async function activeSigningKeyAlg(): Promise<string> {
  const rows = await owner.db
    .select({ alg: signingKeys.alg })
    .from(signingKeys)
    .where(eq(signingKeys.realmId, REALM_ID));
  const alg = rows[0]?.alg;
  if (alg === undefined) throw new Error('the realm holds no signing key');
  return alg;
}

describe('a JWT access token as RFC 9068 §2.1 requires it', () => {
  it('[RFC9068-2.1-02] carries a signature that verifies under the key the realm publishes', async () => {
    const accessToken = await redeemedAccessToken();
    const kid = decodeHeader(accessToken).kid;
    expect(typeof kid).toBe('string');
    expect(rs256SignatureIsValid(accessToken, await publishedJwk(String(kid)))).toBe(true);
  });

  it('[RFC9068-2.1-03] names the realm key algorithm, which no key may spell none', async () => {
    const accessToken = await redeemedAccessToken();
    const alg = await activeSigningKeyAlg();
    expect(decodeHeader(accessToken).alg).toBe(alg);
    expect(['RS256', 'ES256']).toContain(alg);

    // The algorithm in the header is the stored key's, so "never `none`" is
    // a property of what signing_keys can hold rather than of this fixture:
    // signing_keys_alg_check (packages/db/drizzle/0003_signing_keys.sql) is
    // what refuses the row an unsigned access token would need.
    const stored = await withRealm(app.db, REALM_ID, (tx) =>
      tx.insert(signingKeys).values({
        id: newId(),
        realmId: REALM_ID,
        kid: `unsigned-${newId()}`,
        alg: 'none',
        status: 'active',
        publicJwk: {},
        privateJwkEncrypted: 'ciphertext-placeholder',
      }),
    ).then(
      () => true,
      () => false,
    );
    expect(stored).toBe(false);
  });

  // "Include RS256 among their supported signature algorithms" is a claim
  // about both ends at once, so both ends answer it here: the realm mints an
  // RS256 access token, and the resource server this same deployment runs
  // accepts it.
  it('[RFC9068-2.1-05] is minted under RS256 by this realm and accepted under RS256 by its resource server', async () => {
    expect(await activeSigningKeyAlg()).toBe('RS256');

    const accessToken = await redeemedAccessToken();
    expect(decodeHeader(accessToken).alg).toBe('RS256');
    const kid = String(decodeHeader(accessToken).kid);
    expect((await publishedJwk(kid)).kty).toBe('RSA');
    expect(rs256SignatureIsValid(accessToken, await publishedJwk(kid))).toBe(true);
    expect((await userinfo(accessToken)).statusCode).toBe(200);
  });

  it('[RFC9068-2.1-04] declares the at+jwt media type in its typ header parameter', async () => {
    expect(decodeHeader(await redeemedAccessToken()).typ).toBe('at+jwt');
  });
});

async function userinfo(token: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'GET',
    url: `/realms/${REALM}/protocol/openid-connect/userinfo`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function base64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// The claims an access token of this realm carries, built from the values
// the realm was seeded with rather than lifted off a genuine token, so a
// forgery differs from the real thing in its signature and nothing else.
async function accessTokenClaims(): Promise<Record<string, unknown>> {
  const issuer = String(await discoveryIssuer());
  const iat = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    sub: subjectId,
    aud: [AUDIENCE, issuer],
    client_id: webApp.clientId,
    scope: 'openid profile',
    iat,
    exp: iat + 300,
    jti: newId(),
  };
}

describe('the userinfo endpoint validates a token against the keys this realm publishes', () => {
  it('[RFC9068-4-06] refuses a token whose header names alg none', async () => {
    const kid = String(decodeHeader(await redeemedAccessToken()).kid);
    const header = base64urlJson({ alg: 'none', kid, typ: 'at+jwt' });
    const payload = base64urlJson(await accessTokenClaims());

    const res = await userinfo(`${header}.${payload}.`);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('[RFC9068-4-07] refuses a token signed by a key it does not publish, under a kid it does', async () => {
    const genuine = await redeemedAccessToken();
    expect((await userinfo(genuine)).statusCode).toBe(200);

    const foreign = await generateSigningKey('RS256', KEK);
    const impersonating: SigningKeyRecord = {
      id: newId(),
      realmId: REALM_ID,
      kid: String(decodeHeader(genuine).kid),
      alg: foreign.alg,
      status: 'active',
      publicJwk: foreign.publicJwk,
      privateJwkEncrypted: foreign.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    const forged = await signJwt(await accessTokenClaims(), {
      key: impersonating,
      kek: KEK,
      typ: 'at+jwt',
    });

    const res = await userinfo(forged);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC7636-4.5-02] the transform is the one bound to the code, never one the client names', () => {
  // A code whose stored challenge *is* the verifier redeems under `plain`
  // and cannot redeem under `S256`, so it tells the two transforms apart.
  it('refuses a verifier that would only match under the plain transform the request asked for', async () => {
    const { code } = await issueCode({ codeChallenge: VERIFIER });
    const res = await postForm(
      [...redemptionParams(code), ['code_challenge_method', 'plain']],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('redeems a code bound to S256 whatever method the request names', async () => {
    const { code } = await issueCode();
    const res = await postForm(
      [...redemptionParams(code), ['code_challenge_method', 'plain']],
      basicHeader(webApp),
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('[RFC7636-7.2-01] S256 is supported, and it is the transform actually applied', () => {
  it('advertises S256 and redeems a code challenged with an S256 digest', async () => {
    const advertised = (await discoveryDocumentOf()).code_challenge_methods_supported;
    expect(advertised).toEqual(['S256']);

    const { code } = await issueCode({ codeChallenge: CHALLENGE });
    expect((await redeem(code, { verifier: VERIFIER })).statusCode).toBe(200);
  });
});

describe('what an issued access token is restricted to', () => {
  it('[RFC6750-5.2-03] carries a scope claim naming the scope the grant was made for, not a fixed one', async () => {
    expect(decodePayload(await redeemedAccessToken()).scope).toBe('openid profile');
    expect(decodePayload(await redeemedAccessToken({ scope: 'openid' })).scope).toBe('openid');
  });

  it('[RFC6750-5.3-02] carries an aud restricted to the configured audiences and this issuer', async () => {
    const issuer = await discoveryIssuer();
    expect(decodePayload(await redeemedAccessToken()).aud).toEqual([AUDIENCE, issuer]);
  });
});

describe('realm isolation', () => {
  it('isolates token_grants by realm', async () => {
    await expectRealmIsolation(app.db, {
      table: 'token_grants',
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
        await tx.insert(tokenGrants).values({
          id: newId(),
          realmId,
          clientId: clientDbId,
          subjectId: subject.id,
          scope: 'openid',
          audience: ['https://api.example'],
        });
      },
    });
  });
});
