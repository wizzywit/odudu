import { generateSigningKey, signingKeys } from '@odudu/crypto';
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
  secret?: string | null;
  verifier?: string | null;
  redirectUri?: string;
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

  const secret = opts.secret === null ? undefined : (opts.secret ?? client.secret ?? undefined);
  if (secret !== undefined) {
    const basic = Buffer.from(`${client.clientId}:${secret}`).toString('base64');
    headers.authorization = `Basic ${basic}`;
  } else {
    form.set('client_id', client.clientId);
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

  // A refresh token is not issued by this grant in P1 (no refresh_tokens
  // table exists yet — that is a later task's migration), so revocation is
  // proven directly against the grant row the first redemption created,
  // rather than by attempting to use a refresh token that does not exist.
  it('[RFC6749-4.1.2-04] revokes the grant issued by the first redemption', async () => {
    const { code, codeHash } = await issueCode();
    const first = await redeem(code);
    expect(first.statusCode).toBe(200);

    await redeem(code);

    const grantId = await grantIdForCode(codeHash);
    expect(grantId).toBeTruthy();
    if (grantId === null) throw new Error('expected the first redemption to have a grant');
    expect(await grantRevokedAt(grantId)).not.toBeNull();
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

describe('[RFC6749-3.2.1-01] client authentication', () => {
  it('returns 401 and WWW-Authenticate for a bad secret', async () => {
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
