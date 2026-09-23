import {
  generateSigningKey,
  signingKeyRepository,
  signingKeys,
  signJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant, sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { roleRepository } from '@odudu/domain-authz';
import {
  clientRepository,
  clients,
  clientScopeRepository,
  provisionClientDefaults,
} from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { clientOidcConfig } from '#/schema/client-oidc-config';
import { hashRefreshToken } from '#/service/refresh';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';
import { resolveExchangeToken, type ResolveDeps } from '#/usecase/token-exchange-subject';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'token-exchange-client';
const CLIENT_SECRET = 'token-exchange-client-secret';
// Named but never registered as a real client row: an id_token exchange's
// audience check is a string comparison against the requesting client_id,
// with no other client fact behind it.
const OTHER_CLIENT_ID = 'token-exchange-other-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
// Distinct identities for the nested-delegation test below: with every role
// signed in as USERNAME, an actor id and a subject id are the same value,
// so the chain's own assertion could not tell a swapped level from a
// correct one. `keeps a nested act chain...` is the only caller.
const DELEGATE_USERNAME = 'kai';
const DELEGATE_PASSWORD = 'the quick brown fox jumps';
const INNER_ACTOR_USERNAME = 'zola';
const INNER_ACTOR_PASSWORD = 'over the lazy dog again';
const KEK = Buffer.alloc(32, 23);

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// Generous enough that no session under test idles out from underneath a
// liveness check — this file's own resolution rules are what each test
// pins, not the idle window.
const GENEROUS_LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};

let TENANT: string;
let TENANT_ID: string;
let resolveDeps: ResolveDeps;
// Shared by every route this file's `http` serves — advanced only by the
// one test that needs to tell "no time passed" from "nothing touched the
// session regardless of time", never reset.
let fakeClock: FakeClock;

async function setupTenant(name: string, tenantId: string): Promise<void> {
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Token exchange test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token', TOKEN_EXCHANGE_GRANT],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: ['https://api.example'],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    for (const [username, password] of [
      [USERNAME, PASSWORD],
      [DELEGATE_USERNAME, DELEGATE_PASSWORD],
      [INNER_ACTOR_USERNAME, INNER_ACTOR_PASSWORD],
    ] as const) {
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: await hashPassword(password) },
      });
    }

    const generated = await generateSigningKey('ES256', KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    await tx.insert(signingKeys).values({
      id: key.id,
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
}

function authorizeUrl(tenantName: string, scope: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
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

// Decodes without verifying: used only to read what the issuance path
// minted, never to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function issuerOf(claims: Record<string, unknown>): string {
  const iss = claims.iss;
  if (typeof iss !== 'string') throw new Error('expected a string iss claim');
  return iss;
}

function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

async function redeemCode(
  tenantName: string,
  code: string,
): Promise<{ access_token: string; id_token: string; refresh_token: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(res.statusCode)}`);
  }
  return res.json<{ access_token: string; id_token: string; refresh_token: string }>();
}

interface LoggedInToken {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  sessionId: string;
  subjectId: string;
  grantId: string;
  // Set only when the requested scope carried `offline_access`: the same
  // `accessToken` above, named for what distinguishes it in that case — its
  // grant carries no session, unlike `sessionId`, still the browser's own
  // login session and still endable.
  offlineAccessToken?: string;
}

// Signs USERNAME/PASSWORD in against a fresh authorization request, all the
// way through to a redeemed grant — the fixture shape resource-token.int
// .test.ts and sid-claim.int.test.ts both use, extended to also read back
// the subject and grant a resolution should recover.
async function loginAndGetToken(
  options: { tenantName?: string; scope?: string; username?: string; password?: string } = {},
): Promise<LoggedInToken> {
  const tenantName = options.tenantName ?? TENANT;
  const scope = options.scope ?? 'openid';
  const username = options.username ?? USERNAME;
  const password = options.password ?? PASSWORD;
  const authorize = await http.inject({ url: authorizeUrl(tenantName, scope) });
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
    username,
    password,
  });
  const submitted = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (submitted.statusCode !== 302) {
    throw new Error(`expected a successful login, got ${String(submitted.statusCode)}`);
  }
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  const sessionId = cookie.split('=')[1];
  if (sessionId === undefined) throw new Error('expected a session id in the cookie');

  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const redeemed = await redeemCode(tenantName, code);
  const accessClaims = decode(redeemed.access_token);
  const subjectId = accessClaims.sub;
  const grantId = accessClaims.grant_id;
  if (typeof subjectId !== 'string' || typeof grantId !== 'string') {
    throw new Error('expected sub and grant_id on the minted access token');
  }

  return {
    accessToken: redeemed.access_token,
    idToken: redeemed.id_token,
    refreshToken: redeemed.refresh_token,
    sessionId,
    subjectId,
    grantId,
    ...(scope.split(' ').includes('offline_access')
      ? { offlineAccessToken: redeemed.access_token }
      : {}),
  };
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

  // Rounded to a whole second: every claim this suite mints (`iat`, `exp`)
  // is itself whole seconds, so a fractional start here would make an
  // expires_in computed from a ms difference round differently from one
  // computed by subtracting two already-floored second counts.
  fakeClock = new FakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clock: fakeClock,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;

  TENANT = `token-exchange-${newId()}`;
  TENANT_ID = newId();
  await setupTenant(TENANT, TENANT_ID);

  const seed = await loginAndGetToken();
  resolveDeps = {
    issuer: issuerOf(decode(seed.accessToken)),
    requestingClientId: CLIENT_ID,
    lifespans: GENEROUS_LIFESPANS,
    now: new Date(),
  };
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-01] an access token as subject_token', () => {
  it('resolves to its grant subject, scope and session', async () => {
    const { accessToken, grantId, sessionId, subjectId } = await loginAndGetToken();

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', accessToken),
    );

    expect(outcome).toMatchObject({ kind: 'ok', token: { subjectId, grantId, sessionId } });
    if (outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.token.scope).toEqual(expect.arrayContaining(['openid']));
  });

  it('refuses a token whose grant was revoked', async () => {
    const { accessToken, grantId } = await loginAndGetToken();
    await withTenant(app.db, TENANT_ID, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, new Date()),
    );

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', accessToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('refuses a syntactically valid token this tenant did not sign', async () => {
    const foreignTenant = `token-exchange-foreign-${newId()}`;
    const foreignTenantId = newId();
    await setupTenant(foreignTenant, foreignTenantId);
    const { accessToken: foreignAccessToken } = await loginAndGetToken({
      tenantName: foreignTenant,
    });

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', foreignAccessToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});

async function rotateOnce(refreshToken: string): Promise<void> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`expected the rotation to succeed, got ${String(res.statusCode)}`);
  }
}

describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-02] a refresh token as subject_token', () => {
  it('resolves without consuming it, so it still refreshes afterwards', async () => {
    const { refreshToken } = await loginAndGetToken();

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'refresh_token', refreshToken),
    );
    expect(outcome.kind).toBe('ok');

    // RFC 8693 §2.1: "the act of performing a token exchange has no impact
    // on the validity of the subject token".
    const refreshed = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
      },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    expect(refreshed.statusCode).toBe(200);
  });

  it('refuses one already consumed by a rotation', async () => {
    const { refreshToken } = await loginAndGetToken();
    await rotateOnce(refreshToken);

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'refresh_token', refreshToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});

async function exchange(input: {
  subjectToken: string;
  subjectTokenType?: string;
  actorToken?: string;
  actorTokenType?: string;
  requestedTokenType?: string;
  resource?: string;
  scope?: string;
}): Promise<LightMyRequestResponse> {
  const fields: Record<string, string> = {
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: input.subjectToken,
    subject_token_type: input.subjectTokenType ?? 'urn:ietf:params:oauth:token-type:access_token',
  };
  if (input.actorToken !== undefined) {
    fields.actor_token = input.actorToken;
    fields.actor_token_type =
      input.actorTokenType ?? 'urn:ietf:params:oauth:token-type:access_token';
  }
  if (input.requestedTokenType !== undefined)
    fields.requested_token_type = input.requestedTokenType;
  if (input.resource !== undefined) fields.resource = input.resource;
  if (input.scope !== undefined) fields.scope = input.scope;

  const form = new URLSearchParams(fields);
  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
}

function decodeExp(token: string): number {
  const exp = decode(token).exp;
  if (typeof exp !== 'number') throw new Error('expected a numeric exp claim');
  return exp;
}

// Reads the same clock `/token` itself reads (`fakeClock`, wired into
// `http` above) — the real wall clock would make a ttl-ceiling assertion
// flaky by the runtime's own timing, not by anything this file controls.
function fakeNowSeconds(): number {
  return Math.floor(fakeClock.now().getTime() / 1000);
}

// Matches the `accessTokenTtlSeconds` this file's own setupTenant configures
// for CLIENT_ID.
const ACCESS_TOKEN_TTL_SECONDS = 300;

// Approximates an expired access token by revoking its grant: nothing here
// controls the real clock jose's own exp check reads inside verifyJwt, so
// waiting out a TTL is not practical in this suite. resolveAccessToken
// refuses a dead grant exactly like an expired JWT — one bare `refused`,
// nothing left to tell them apart — which is the boundary this test probes.
async function expireAccessToken(grantId: string): Promise<void> {
  await withTenant(app.db, TENANT_ID, (tx) => tokenGrantRepository(tx).revoke(grantId, new Date()));
}

// Impersonation — an exchange with no actor_token — defaults to refused
// (client-oidc-config.ts), so any test exercising it must opt in first.
// No repository method flips this one column, so the test reaches for the
// schema directly rather than adding a single-purpose write method.
async function allowImpersonation(oauthClientId: string): Promise<void> {
  await withTenant(app.db, TENANT_ID, async (tx) => {
    const client = await clientRepository(tx).byClientId(oauthClientId);
    if (client === null) throw new Error(`unknown client ${oauthClientId}`);
    await tx
      .update(clientOidcConfig)
      .set({ tokenExchangeImpersonationAllowed: true })
      .where(eq(clientOidcConfig.clientId, client.id));
  });
}

describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-03] an id_token as subject_token', () => {
  it('resolves when its aud names the requesting client', async () => {
    const { idToken, subjectId } = await loginAndGetToken();
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: CLIENT_ID },
        'id_token',
        idToken,
      ),
    );
    expect(outcome).toMatchObject({ kind: 'ok', token: { subjectId } });
  });

  // An ID token is an authentication receipt for one client, not a bearer
  // credential for APIs, so a holder that is not its audience may not
  // exchange it. Stricter than RFC 8693 requires.
  it('refuses when another client presents it', async () => {
    const { idToken } = await loginAndGetToken();
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: OTHER_CLIENT_ID },
        'id_token',
        idToken,
      ),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('refuses an id_token signed by another tenant', async () => {
    const foreignTenant = `token-exchange-foreign-idtoken-${newId()}`;
    const foreignTenantId = newId();
    await setupTenant(foreignTenant, foreignTenantId);
    const { idToken: foreignIdToken } = await loginAndGetToken({ tenantName: foreignTenant });

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: CLIENT_ID },
        'id_token',
        foreignIdToken,
      ),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-ACTOR-01] the actor token is checked too', () => {
  it('refuses an expired actor token beside a live subject token', async () => {
    const subject = await loginAndGetToken();
    const actor = await loginAndGetToken();
    await expireAccessToken(actor.grantId);

    const response = await exchange({
      subjectToken: subject.accessToken,
      actorToken: actor.accessToken,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: string }>()).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses an actor token whose grant was revoked', async () => {
    const subject = await loginAndGetToken();
    const actor = await loginAndGetToken();
    await withTenant(app.db, TENANT_ID, (tx) =>
      tokenGrantRepository(tx).revoke(actor.grantId, new Date()),
    );

    const response = await exchange({
      subjectToken: subject.accessToken,
      actorToken: actor.accessToken,
    });
    expect(response.statusCode).toBe(400);
  });
});

// Nothing mints `may_act` yet (docs/NEXT.md's own entry on this), so this
// re-signs a real, grant-backed access token with the claim added — the
// only way to exercise `mayActPermits`'s wiring end to end before P5 gives
// it a mint path of its own.
async function withMayAct(accessToken: string, sub: string): Promise<string> {
  const claims = decode(accessToken);
  const key = await withTenant(app.db, TENANT_ID, (tx) => signingKeyRepository(tx).active());
  if (key === null) throw new Error('expected an active signing key');
  return signJwt({ ...claims, may_act: { sub } }, { key, kek: KEK, typ: 'at+jwt' });
}

describe('[ODUDU-TOKEN-EXCHANGE-MAYACT-02] may_act is honoured and violated end to end', () => {
  it('refuses an actor the subject token does not name in may_act', async () => {
    const subject = await loginAndGetToken();
    const namedActor = await loginAndGetToken({
      username: DELEGATE_USERNAME,
      password: DELEGATE_PASSWORD,
    });
    const otherActor = await loginAndGetToken();
    const subjectToken = await withMayAct(subject.accessToken, namedActor.subjectId);

    const response = await exchange({ subjectToken, actorToken: otherActor.accessToken });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: string }>()).toMatchObject({ error: 'invalid_request' });
  });

  it('permits the actor may_act names', async () => {
    const subject = await loginAndGetToken();
    const namedActor = await loginAndGetToken({
      username: DELEGATE_USERNAME,
      password: DELEGATE_PASSWORD,
    });
    const subjectToken = await withMayAct(subject.accessToken, namedActor.subjectId);

    const response = await exchange({ subjectToken, actorToken: namedActor.accessToken });
    expect(response.statusCode).toBe(200);
    expect(decode(response.json<{ access_token: string }>().access_token).act).toEqual({
      sub: namedActor.subjectId,
    });
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-01] the grant end to end', () => {
  it('delegates: sub is the subject, act names the actor', async () => {
    const subject = await loginAndGetToken();
    const actor = await loginAndGetToken();
    const response = await exchange({
      subjectToken: subject.accessToken,
      actorToken: actor.accessToken,
      resource: 'https://api.example',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      issued_token_type?: string;
      token_type?: string;
      access_token: string;
    }>();
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(body.token_type).toBe('Bearer');
    const claims = decode(body.access_token);
    expect(claims.sub).toBe(subject.subjectId);
    expect(claims.act).toEqual({ sub: actor.subjectId });
    expect(claims.aud).toContain('https://api.example');
  });

  it('impersonates only when the client is permitted', async () => {
    const subject = await loginAndGetToken();
    const refused = await exchange({ subjectToken: subject.accessToken });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error?: string }>()).toMatchObject({ error: 'unauthorized_client' });

    await allowImpersonation(CLIENT_ID);
    const allowed = await exchange({ subjectToken: subject.accessToken });
    expect(allowed.statusCode).toBe(200);
    expect(decode(allowed.json<{ access_token: string }>().access_token).act).toBeUndefined();
  });

  it('refuses a scope wider than the subject token holds', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      scope: 'openid roles',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: string }>()).toMatchObject({ error: 'invalid_scope' });
  });

  // RFC 8693 §2.2.1: the response's scope member reflects the issued
  // scope, not the subject token's whole grant, whenever a request narrows
  // it — the MUST a bare "scope is always present" row cannot tell apart
  // from a subject-token-wide scope happening to be echoed back unnarrowed.
  it('narrows the response scope to what was requested, not the subject grant', async () => {
    const subject = await loginAndGetToken({ scope: 'openid profile' });
    // Demonstrates the subset rather than assuming it: if this client ever
    // lost the `profile` scope, the subject token would carry `openid`
    // alone and the narrowing below would silently become a no-op.
    expect(decode(subject.accessToken).scope).toBe('openid profile');
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      scope: 'openid',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ scope?: string }>().scope).toBe('openid');
  });

  it('refuses a refused token type with invalid_request', async () => {
    const subject = await loginAndGetToken();
    const response = await exchange({
      subjectToken: subject.accessToken,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: string }>()).toMatchObject({ error: 'invalid_request' });
  });

  it('issues an id_token addressed to the requesting client', async () => {
    const subject = await loginAndGetToken({ scope: 'openid' });
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
    });

    const body = response.json<{ issued_token_type?: string; access_token: string }>();
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:id_token');
    expect(decode(body.access_token).aud).toBe(CLIENT_ID);
  });

  // client_scopes.include_in_id_token is off for `roles`/`groups`
  // (provision-defaults.ts) precisely because the ID token reaches the
  // browser and a client cannot opt out of what lands there —
  // issueAuthorizationCodeTokens already withholds it; an exchange must
  // withhold it identically.
  it('withholds roles from an exchanged id_token, as authorization_code does', async () => {
    const subject = await loginAndGetToken({ scope: 'openid roles' });
    await allowImpersonation(CLIENT_ID);
    await withTenant(app.db, TENANT_ID, async (tx) => {
      const role = await roleRepository(tx).create({
        tenantId: TENANT_ID,
        name: `exchange-role-${newId()}`,
      });
      await roleRepository(tx).assignToSubject(subject.subjectId, role.id);
      const scope = await clientScopeRepository(tx).byName('roles');
      if (scope === null) throw new Error('tenant does not define a roles scope');
      await roleRepository(tx).mapToClientScope(scope.id, role.id);
    });

    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
    });
    expect(response.statusCode).toBe(200);
    const claims = decode(response.json<{ access_token: string }>().access_token);
    expect(claims.roles).toBeUndefined();
  });

  it('refuses a target named alongside a requested id_token', async () => {
    const subject = await loginAndGetToken({ scope: 'openid' });
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
      resource: 'https://api.example',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: string }>()).toMatchObject({ error: 'invalid_target' });
  });

  it('returns a refresh token in access_token when one is requested', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
    const body = response.json<{
      issued_token_type?: string;
      token_type?: string;
      access_token: string;
    }>();
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:refresh_token');
    expect(body.token_type).toBe('N_A');
    expect(body.access_token).toEqual(expect.any(String));
  });
});

async function rotate(refreshToken: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
}

describe('[ODUDU-TOKEN-EXCHANGE-ROTATION-01] a rotated exchanged refresh token keeps its limits', () => {
  it('keeps a nested act chain and the subject exp ceiling through two rotations', async () => {
    const subject = await loginAndGetToken();
    const delegateHolder = await loginAndGetToken({
      username: DELEGATE_USERNAME,
      password: DELEGATE_PASSWORD,
    });
    const innerActor = await loginAndGetToken({
      username: INNER_ACTOR_USERNAME,
      password: INNER_ACTOR_PASSWORD,
    });
    // Three distinct subjects, or a swapped actor level and a subject id
    // substituted for an actor id would both read as correct below.
    expect(new Set([subject.subjectId, delegateHolder.subjectId, innerActor.subjectId]).size).toBe(
      3,
    );

    // Builds an actor_token that already carries its own `act` — the
    // second exchange below nests beneath it, so the resulting chain has
    // two levels rather than one. buildActChain's own nesting is unit
    // tested (ACT-01); this is the end-to-end proof that a nested chain
    // survives persistence and rotation with its shape intact, not just a
    // single-level one that would pass either way.
    const delegatedActorResponse = await exchange({
      subjectToken: delegateHolder.accessToken,
      actorToken: innerActor.accessToken,
    });
    expect(delegatedActorResponse.statusCode).toBe(200);
    const delegatedActorToken = delegatedActorResponse.json<{ access_token: string }>()
      .access_token;

    const subjectExp = decodeExp(subject.accessToken);
    const expectedAct = { sub: delegateHolder.subjectId, act: { sub: innerActor.subjectId } };

    const exchangeResponse = await exchange({
      subjectToken: subject.accessToken,
      actorToken: delegatedActorToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
    expect(exchangeResponse.statusCode).toBe(200);
    const exchangedRefreshToken = exchangeResponse.json<{ access_token: string }>().access_token;

    // Moves past the subject token's own mint instant, so an uncapped
    // rotation would land strictly later than subjectExp — the only way
    // an exact-equality assertion below can tell a real ceiling from the
    // two simply coinciding by construction.
    advanceClock(60_000);
    const uncappedExp = fakeNowSeconds() + ACCESS_TOKEN_TTL_SECONDS;

    const firstRotation = await rotate(exchangedRefreshToken);
    expect(firstRotation.statusCode).toBe(200);
    const firstBody = firstRotation.json<{ access_token: string; refresh_token: string }>();
    // The whole point of a delegated credential: `act` must survive
    // rotation, nesting intact, not just the token minted at exchange time.
    expect(decode(firstBody.access_token).act).toEqual(expectedAct);
    expect(decodeExp(firstBody.access_token)).toBe(subjectExp);
    expect(decodeExp(firstBody.access_token)).toBeLessThan(uncappedExp);

    // And again — the ceiling and the full chain must survive a second
    // hop, not just the first one after the exchange.
    const secondRotation = await rotate(firstBody.refresh_token);
    expect(secondRotation.statusCode).toBe(200);
    const secondBody = secondRotation.json<{ access_token: string; refresh_token: string }>();
    expect(decode(secondBody.access_token).act).toEqual(expectedAct);
    expect(decodeExp(secondBody.access_token)).toBe(subjectExp);
    expect(decodeExp(secondBody.access_token)).toBeLessThan(uncappedExp);
  });

  it('caps the rotated refresh token itself, not just the access token it mints', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const subjectExpDate = new Date(decodeExp(subject.accessToken) * 1000);

    const exchangeResponse = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
    const exchangedRefreshToken = exchangeResponse.json<{ access_token: string }>().access_token;

    const rotation = await rotate(exchangedRefreshToken);
    expect(rotation.statusCode).toBe(200);
    const body = rotation.json<{ refresh_token: string }>();

    // The rotated refresh token is opaque, so the cap is checked in the
    // database it was written to, not by decoding it.
    const record = await withTenant(app.db, TENANT_ID, (tx) =>
      refreshTokenRepository(tx).byHash(hashRefreshToken(body.refresh_token)),
    );
    expect(record?.expiresAt).toEqual(subjectExpDate);
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-ORACLE-01] impersonation is refused before the subject token is read', () => {
  it('refuses with unauthorized_client even for a garbage subject token', async () => {
    const restrictedClientId = 'token-exchange-no-impersonation-client';
    const restrictedSecret = 'token-exchange-no-impersonation-secret';
    const restrictedDbId = newId();
    await withTenant(app.db, TENANT_ID, async (tx) => {
      await tx.insert(clients).values({
        id: restrictedDbId,
        tenantId: TENANT_ID,
        clientId: restrictedClientId,
        name: 'No impersonation client',
        type: 'confidential',
        secretHash: await hashPassword(restrictedSecret),
      });
      // tokenExchangeImpersonationAllowed defaults to false — never set here.
      await clientOidcConfigRepository(tx).create({
        clientId: restrictedDbId,
        tenantId: TENANT_ID,
        // client_oidc_config_redirect_uris_present requires a non-empty
        // list for any grant list other than exactly ['client_credentials'].
        redirectUris: [REDIRECT_URI],
        grantTypes: [TOKEN_EXCHANGE_GRANT],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
    });

    const form = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: 'not-a-real-token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const response = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      payload: form.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basicAuth(restrictedClientId, restrictedSecret),
      },
    });

    // invalid_request would mean the subject token was resolved (and
    // refused) before the impersonation permission was ever checked —
    // exactly the ordering that turns this response into an oracle for
    // the subject token's own validity.
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: string }>()).toMatchObject({ error: 'unauthorized_client' });
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-EXPIRY-01] the issued token is capped at the subject token', () => {
  it('caps the issued access token exp exactly at the subject token exp', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const subjectExp = decodeExp(subject.accessToken);

    // Moves past the subject token's own mint instant, so the exchange's
    // own ttl-based exp (fakeNow + ttl) would land strictly later than the
    // subject's — the only way this test can tell a real cap from the two
    // simply coinciding by construction.
    advanceClock(60_000);
    const response = await exchange({ subjectToken: subject.accessToken });
    const body = response.json<{ access_token: string; expires_in: number }>();
    const claims = decode(body.access_token);
    const exp = decodeExp(body.access_token);
    const iat = claims.iat;
    if (typeof iat !== 'number') throw new Error('expected a numeric iat claim');

    expect(exp).toBe(subjectExp);
    expect(exp).toBeLessThan(fakeNowSeconds() + ACCESS_TOKEN_TTL_SECONDS);
    // The defect this pins: expires_in must report the capped lifetime,
    // not the configured ttl regardless of the cap.
    expect(body.expires_in).toBe(exp - iat);
    expect(body.expires_in).toBeLessThan(ACCESS_TOKEN_TTL_SECONDS);
  });

  it('caps the issued id_token exp and its expires_in the same way', async () => {
    const subject = await loginAndGetToken({ scope: 'openid' });
    await allowImpersonation(CLIENT_ID);
    const subjectExp = decodeExp(subject.accessToken);

    advanceClock(60_000);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
    });
    const body = response.json<{ access_token: string; expires_in: number; token_type?: string }>();
    const claims = decode(body.access_token);
    const exp = decodeExp(body.access_token);
    const iat = claims.iat;
    if (typeof iat !== 'number') throw new Error('expected a numeric iat claim');

    expect(exp).toBe(subjectExp);
    expect(body.expires_in).toBe(exp - iat);
    // RFC 8693 §2.2.1: not an access token.
    expect(body.token_type).toBe('N_A');
  });

  it('caps the issued refresh_token expires_in the same way', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const subjectExp = decodeExp(subject.accessToken);

    advanceClock(60_000);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
    const body = response.json<{ expires_in: number; token_type?: string }>();

    // The refresh token itself is opaque, so the capped ceiling is checked
    // against the same subject exp and clock every other case in this
    // describe uses, not by decoding it.
    expect(body.expires_in).toBe(subjectExp - fakeNowSeconds());
    expect(body.expires_in).toBeLessThan(1_209_600);
    expect(body.token_type).toBe('N_A');
  });

  // An id_token subject_token carries its own exp too, and this exchange
  // must never widen it — `resolveIdToken` (token-exchange-subject.ts) used
  // to hand back `expiresAt: null`, so a subject presenting one always
  // escaped the ceiling and received a full-ttl token regardless of how
  // little of its own id_token's lifetime was left.
  it('caps the issued token exp at the id_token subject own exp', async () => {
    const subject = await loginAndGetToken({ scope: 'openid' });
    await allowImpersonation(CLIENT_ID);
    const subjectIdTokenExp = decodeExp(subject.idToken);

    advanceClock(60_000);
    const response = await exchange({
      subjectToken: subject.idToken,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:id_token',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ access_token: string; expires_in: number }>();
    const exp = decodeExp(body.access_token);

    expect(exp).toBe(subjectIdTokenExp);
    expect(exp).toBeLessThan(fakeNowSeconds() + ACCESS_TOKEN_TTL_SECONDS);
  });
});

async function introspect(token: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({ token });
  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token/introspect`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
    },
  });
}

async function userinfo(token: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'GET',
    url: `/tenants/${TENANT}/protocol/openid-connect/userinfo`,
    headers: { authorization: `Bearer ${token}` },
  });
}

// Ends the session against the same clock /token itself reads (`fakeClock`,
// wired into `http` above) — ending it against the real wall clock would
// leave it live by the frozen clock's own reckoning until `advanceClock`
// next moves that clock forward.
async function endSession(sessionId: string): Promise<void> {
  await withTenant(app.db, TENANT_ID, (tx) =>
    sessionRepository(tx).end(sessionId, fakeClock.now()),
  );
}

async function sessionLastSeen(sessionId: string): Promise<Date | undefined> {
  const record = await withTenant(app.db, TENANT_ID, (tx) => sessionRepository(tx).byId(sessionId));
  return record?.lastActiveAt;
}

function advanceClock(ms: number): void {
  fakeClock.advance(ms);
}

describe('[ODUDU-TOKEN-EXCHANGE-SESSION-01] an exchanged token dies with the session', () => {
  it('is dead at /introspect and at /userinfo after logout', async () => {
    const subject = await loginAndGetToken({ scope: 'openid profile' });
    await allowImpersonation(CLIENT_ID);
    const exchanged = (await exchange({ subjectToken: subject.accessToken })).json<{
      access_token: string;
    }>().access_token;

    // Live before, so the assertion after is about the logout and not
    // about the token having been useless all along.
    expect((await introspect(exchanged)).json<{ active: boolean }>().active).toBe(true);
    expect((await userinfo(exchanged)).statusCode).toBe(200);

    await endSession(subject.sessionId);

    expect((await introspect(exchanged)).json<{ active: boolean }>().active).toBe(false);
    expect((await userinfo(exchanged)).statusCode).toBe(401);
  });

  it('refuses a further exchange once the session has ended', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    await endSession(subject.sessionId);

    const response = await exchange({ subjectToken: subject.accessToken });
    expect(response.statusCode).toBe(400);
  });

  it('does not extend the session it rides on', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const before = await sessionLastSeen(subject.sessionId);

    advanceClock(60_000);
    await exchange({ subjectToken: subject.accessToken });

    expect(await sessionLastSeen(subject.sessionId)).toEqual(before);
  });

  // An offline grant has no session, and an exchange from one must not
  // invent a dependency the subject never had — this is as important as
  // the first three cases: inheritance must be inheritance, not a blanket
  // session requirement.
  it('inherits no session from an offline grant, and survives a logout', async () => {
    const subject = await loginAndGetToken({ scope: 'openid offline_access' });
    await allowImpersonation(CLIENT_ID);
    const offlineAccessToken = subject.offlineAccessToken;
    if (offlineAccessToken === undefined) throw new Error('expected an offline access token');
    const exchangeResponse = await exchange({ subjectToken: offlineAccessToken });
    expect(exchangeResponse.statusCode).toBe(200);
    const exchanged = exchangeResponse.json<{ access_token: string }>().access_token;

    await endSession(subject.sessionId);
    expect((await introspect(exchanged)).json<{ active: boolean }>().active).toBe(true);
  });
});
