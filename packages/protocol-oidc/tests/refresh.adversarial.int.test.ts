import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, subjects } from '@odudu/domain-identity';
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
import { authorizationCodeRepository } from '#/repository/codes';
import { refreshTokens } from '#/schema/refresh-tokens';
import { tokenGrants } from '#/schema/token-grants';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';
import { generateRefreshToken, hashRefreshToken } from '#/service/refresh';
import { rotateRefreshToken } from '#/usecase/refresh-rotation';

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
const AUDIENCE = 'https://api.example';
const KEK = Buffer.alloc(32, 7);

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Client {
  clientId: string;
  dbId: string;
  secret: string;
}

let webApp: Client;
let otherApp: Client;
let subjectId: string;

async function setupRealm(): Promise<void> {
  REALM = `refresh-adversarial-${newId()}`;
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
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
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
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [AUDIENCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    otherApp = { clientId: 'other-app', dbId: otherAppDbId, secret: 'othersecret' };

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

function basicAuth(client: Client): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

// Issues a fresh authorization code directly against the repository (as
// token-code.adversarial.int.test.ts does), redeems it through the real
// /token endpoint, and returns the refresh_token that redemption produced —
// the only source of a genuine rt1 for these tests.
async function issueInitialRefreshToken(
  scope = 'openid profile',
): Promise<{ refreshToken: string; grantId: string }> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);

  await withRealm(app.db, REALM_ID, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      realmId: REALM_ID,
      clientId: webApp.dbId,
      subjectId,
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
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(webApp),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ refresh_token?: string }>();
  if (body.refresh_token === undefined) {
    throw new Error('expected the authorization_code grant to issue a refresh token');
  }

  // The redemption bound this code to the grant its refresh token belongs
  // to; reading it back through the repository (rather than raw SQL) keeps
  // this helper honest about what the production code actually persists.
  const record = await withRealm(app.db, REALM_ID, (tx) =>
    authorizationCodeRepository(tx).byHash(codeHash),
  );
  const grantId = record?.grantId;
  if (grantId === null || grantId === undefined) {
    throw new Error('expected the redeemed code to carry a grant id');
  }

  return { refreshToken: body.refresh_token, grantId };
}

interface RefreshOptions {
  as?: Client;
  scope?: string;
}

async function refresh(token: string, opts: RefreshOptions = {}): Promise<LightMyRequestResponse> {
  const client = opts.as ?? webApp;
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', token);
  if (opts.scope !== undefined) form.set('scope', opts.scope);

  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client),
    },
  });
}

async function grantRevokedAt(grantId: string): Promise<Date | null> {
  const rows = await owner.db
    .select({ revokedAt: tokenGrants.revokedAt })
    .from(tokenGrants)
    .where(eq(tokenGrants.id, grantId));
  return rows[0]?.revokedAt ?? null;
}

async function disableSubject(id: string): Promise<void> {
  await owner.db.update(subjects).set({ disabledAt: new Date() }).where(eq(subjects.id, id));
}

describe('[RFC6749-10.4-01] refresh token rotation and reuse detection', () => {
  it('issues a new refresh token and retires the old one', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken();
    const first = await refresh(rt1);
    expect(first.statusCode).toBe(200);
    const rt2 = first.json<{ refresh_token: string }>().refresh_token;
    expect(rt2).not.toEqual(rt1);

    const replay = await refresh(rt1);
    expect(replay.statusCode).toBe(400);
  });

  // The fourth call is the one that actually proves family revocation: a
  // test that stops after the reuse only proves single-use.
  it('revokes the whole family when a used token is presented again', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken();
    const first = await refresh(rt1);
    const rt2 = first.json<{ refresh_token: string }>().refresh_token;

    await refresh(rt1); // the reuse

    const afterward = await refresh(rt2); // the still-live successor
    expect(afterward.statusCode).toBe(400);
    expect(afterward.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('marks the grant revoked, not merely the tokens', async () => {
    const { refreshToken: rt1, grantId } = await issueInitialRefreshToken();
    await refresh(rt1);
    await refresh(rt1); // the reuse

    expect(await grantRevokedAt(grantId)).not.toBeNull();
  });

  // RFC 6749 §6: the binding is to the client the token was issued to, not
  // to any client that can authenticate. otherApp's own credentials are
  // accepted at the endpoint — the first refresh here shows the same
  // request shape succeeding for the client that owns the token — and the
  // refusal is the binding check alone.
  it('[RFC6749-6-06] refuses a refresh token presented by a different client', async () => {
    const own = await issueInitialRefreshToken();
    expect((await refresh(own.refreshToken)).statusCode).toBe(200);

    const foreign = await issueInitialRefreshToken();
    const res = await refresh(foreign.refreshToken, { as: otherApp });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('[RFC6749-6-01] refuses to widen scope on refresh', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken();
    const res = await refresh(rt1, { scope: 'openid profile admin' });
    expect(res.json<{ error: string }>().error).toBe('invalid_scope');
  });

  it('[ODUDU-REFRESH-SCOPE-NARROW-01] permits narrowing scope on refresh', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken();
    const res = await refresh(rt1, { scope: 'openid' });
    expect(res.json<{ scope: string }>().scope).toBe('openid');
  });

  // refresh_tokens has no scope column of its own — the rotated token's
  // scope, when it is next presented, comes from the grant it belongs to,
  // not from whatever was requested on the refresh that minted it. Narrow
  // on the first refresh, then present the resulting token with no scope
  // parameter and confirm it yields the grant's full original scope back,
  // not the narrowed one.
  it('[RFC6749-6-03] the rotated refresh token inherits the grant scope, not the narrowed request that minted it', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken('openid profile');
    const first = await refresh(rt1, { scope: 'openid' });
    expect(first.statusCode).toBe(200);
    const { refresh_token: rt2, scope: firstScope } = first.json<{
      refresh_token: string;
      scope: string;
    }>();
    expect(firstScope).toBe('openid');

    const second = await refresh(rt2);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ scope: string }>().scope).toBe('openid profile');
  });

  it('refuses a refresh token whose subject was disabled since issue', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken();
    await disableSubject(subjectId);
    try {
      const res = await refresh(rt1);
      expect(res.json<{ error: string }>().error).toBe('invalid_grant');
    } finally {
      await owner.db.update(subjects).set({ disabledAt: null }).where(eq(subjects.id, subjectId));
    }
  });

  it('[RFC6749-6-04] refuses a refresh request missing the refresh_token parameter', async () => {
    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');

    const res = await http.inject({
      method: 'POST',
      url: `/realms/${REALM}/protocol/openid-connect/token`,
      payload: form.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(webApp),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');
  });
});

describe('atomic refresh rotation', () => {
  it('two simultaneous refreshes of the same token yield exactly one new token', async () => {
    const { refreshToken: rt1 } = await issueInitialRefreshToken();
    const hash = hashRefreshToken(rt1);
    const now = new Date();

    const results = await Promise.allSettled([
      withRealm(app.db, REALM_ID, (tx) => rotateRefreshToken(tx, hash, now, 1_209_600)),
      withRealm(app.db, REALM_ID, (tx) => rotateRefreshToken(tx, hash, now, 1_209_600)),
    ]);

    const rotated = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'rotated');
    expect(rotated).toHaveLength(1);
  });
});

describe('realm isolation', () => {
  it('isolates refresh_tokens by realm', async () => {
    await expectRealmIsolation(app.db, {
      table: 'refresh_tokens',
      seed: async (tx, realmId) => {
        await tx.insert(realms).values({ id: realmId, name: `probe-${realmId}` });
        const clientDbId = newId();
        await tx.insert(clients).values({
          id: clientDbId,
          realmId,
          clientId: `probe-client-${realmId}`,
          name: 'Isolation probe client',
          type: 'confidential',
          secretHash: 'hashed:secret',
        });
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        const grantRows = await tx
          .insert(tokenGrants)
          .values({
            id: newId(),
            realmId,
            clientId: clientDbId,
            subjectId: subject.id,
            scope: 'openid',
            audience: ['https://api.example'],
          })
          .returning();
        const grant = grantRows[0];
        if (grant === undefined) throw new Error('expected an inserted token grant');
        await tx.insert(refreshTokens).values({
          tokenHash: `probe-hash-${realmId}`,
          realmId,
          grantId: grant.id,
          expiresAt: new Date(Date.now() + 60_000),
        });
      },
    });
  });

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

// Ordered pairs rather than an object, so a request can omit a parameter
// outright instead of sending an empty one.
async function postToken(
  params: [string, string][],
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const body = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/token`,
    payload: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
}

// RFC 6749 §6 restates §3.2.1's client authentication for the refresh
// request specifically, so it is proved on this grant rather than inferred
// from the authorization_code grant enforcing the same rule.
describe('[RFC6749-6-05] client authentication on the refresh request', () => {
  it('refreshes for a confidential client presenting its registered secret', async () => {
    const { refreshToken } = await issueInitialRefreshToken();
    const res = await postToken(
      [
        ['grant_type', 'refresh_token'],
        ['refresh_token', refreshToken],
      ],
      { authorization: basicAuth(webApp) },
    );
    expect(res.statusCode).toBe(200);
  });

  it('refuses the same request with a wrong secret', async () => {
    const { refreshToken } = await issueInitialRefreshToken();
    const wrong = `Basic ${Buffer.from(`${webApp.clientId}:not-the-secret`).toString('base64')}`;
    const res = await postToken(
      [
        ['grant_type', 'refresh_token'],
        ['refresh_token', refreshToken],
      ],
      { authorization: wrong },
    );
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('refuses the same request from a client that names itself but presents no credential', async () => {
    const { refreshToken } = await issueInitialRefreshToken();
    const res = await postToken([
      ['grant_type', 'refresh_token'],
      ['refresh_token', refreshToken],
      ['client_id', webApp.clientId],
    ]);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('refuses the same request with no client identification at all', async () => {
    const { refreshToken } = await issueInitialRefreshToken();
    const res = await postToken([
      ['grant_type', 'refresh_token'],
      ['refresh_token', refreshToken],
    ]);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });
});

describe('[RFC6749-6-07] the presented refresh token is validated', () => {
  it('refuses a token that was never issued', async () => {
    const res = await refresh(generateRefreshToken());
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('refuses a token whose expiry has passed, and accepts the same token before it', async () => {
    const live = await issueInitialRefreshToken();
    expect((await refresh(live.refreshToken)).statusCode).toBe(200);

    // Identical in every respect but expires_at, which is what makes the
    // refusal below about the expiry and nothing else.
    const aged = await issueInitialRefreshToken();
    await owner.db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(aged.refreshToken)));

    const res = await refresh(aged.refreshToken);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('refuses a token that has already been redeemed once', async () => {
    const { refreshToken } = await issueInitialRefreshToken();
    expect((await refresh(refreshToken)).statusCode).toBe(200);

    const replay = await refresh(refreshToken);
    expect(replay.statusCode).toBe(400);
    expect(replay.json<{ error: string }>().error).toBe('invalid_grant');
  });
});
