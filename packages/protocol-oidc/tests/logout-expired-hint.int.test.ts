import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
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
import { sessionRepository, provisionTenant, type SessionLifespans } from '@odudu/authn-flows';
import { auditEvents } from '@odudu/domain-audit';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { confirmationFields, confirmLogoutPage } from '#/testing/logout-confirmation';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'logout-client';
const CLIENT_SECRET = 'logout-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const POST_LOGOUT_REDIRECT_URI = 'https://app.example/after-logout';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 11);

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// Generous enough that no session under test idles out from underneath a
// liveness check — this file's own logout mechanics are what each test
// pins, not the idle window.
const GENEROUS_LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function setupTenant(name: string): Promise<{ tenantId: string; clientDbId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Logout test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      postLogoutRedirectUris: [POST_LOGOUT_REDIRECT_URI],
    });

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });

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
    signingKeyOf.set(name, key);
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
  return { tenantId, clientDbId };
}

async function subjectIdOf(tenantId: string, username: string): Promise<string> {
  const rows = await owner.db
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in tenant ${tenantId}`);
  return row.subjectId;
}

async function issuerFor(tenantName: string): Promise<string> {
  const res = await http.inject({
    url: `/tenants/${tenantName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

const AN_HOUR = 3600;
const THREE_YEARS = 3 * 365 * 24 * 3600;

interface HintOptions {
  sid?: string | null;
  // Seconds before now that `exp` fell; a live hint is minted with 0 and is
  // then valid for another five minutes.
  expiredFor?: number;
  aud?: string;
  claims?: Record<string, unknown>;
  key?: SigningKeyRecord;
  typ?: string;
}

async function mintHint(
  tenantName: string,
  sub: string,
  options: HintOptions = {},
): Promise<string> {
  const key = options.key ?? signingKeyOf.get(tenantName);
  if (key === undefined) throw new Error(`no signing key for ${tenantName}`);
  const now = Math.floor(Date.now() / 1000);
  const exp = options.expiredFor === undefined ? now + 300 : now - options.expiredFor;
  return signJwt(
    {
      iss: await issuerFor(tenantName),
      aud: options.aud ?? CLIENT_ID,
      sub,
      iat: exp - 300,
      exp,
      ...(options.sid === null || options.sid === undefined ? {} : { sid: options.sid }),
      ...options.claims,
    },
    { key, kek: KEK, ...(options.typ === undefined ? {} : { typ: options.typ }) },
  );
}

function authorizeUrl(tenantName: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

// Two cookies travel on a successful login now (session-cookie.ts, the one
// authority): the ephemeral list and the persistent one. This walks the
// browser's SSO session, never the remembered one, which stays empty until
// a login can ask to be remembered.
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

async function signIn(tenantName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenantName) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found');

  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const submitted = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  return cookie;
}

function sessionIdFromCookie(cookie: string): string {
  const id = cookie.split('=')[1]?.split(':')[0];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

function logoutUrl(tenantName: string, overrides: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = { ...overrides };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const suffix = query.toString();
  return `/tenants/${tenantName}/protocol/openid-connect/logout${suffix === '' ? '' : `?${suffix}`}`;
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
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function sessionIsLive(tenantId: string, sessionId: string): Promise<boolean> {
  const row = await withTenant(app.db, tenantId, (tx) =>
    sessionRepository(tx).liveById(sessionId, GENEROUS_LIFESPANS, new Date()),
  );
  return row !== null;
}

async function endedAuditRows(
  tenantId: string,
  sessionId: string,
): Promise<{ detail: unknown; outcome: string }[]> {
  return owner.db
    .select({ detail: auditEvents.detail, outcome: auditEvents.outcome })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, 'session.ended'),
        eq(auditEvents.resourceId, sessionId),
      ),
    );
}

const END_PARAMS = {
  client_id: CLIENT_ID,
  post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI,
  state: 'st',
};

async function getAndConfirm(
  tenantName: string,
  cookie: string,
  params: Record<string, string>,
): Promise<LightMyRequestResponse> {
  const page = await http.inject({ url: logoutUrl(tenantName, params), headers: { cookie } });
  return confirmLogoutPage(http, tenantName, cookie, page);
}

describe('[OIDC-RPINITIATED-2-05] a hint past its exp is accepted when it names the live session', () => {
  it('an expired hint still identifies the session and asks', async () => {
    const tenantName = `logout-lapsed-asks-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const older = await signIn(tenantName);
    const newer = await signIn(tenantName);
    const olderId = sessionIdFromCookie(older);
    const hint = await mintHint(tenantName, await subjectIdOf(tenantId, USERNAME), {
      sid: olderId,
      expiredFor: AN_HOUR,
    });

    const page = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint, ...END_PARAMS }),
      headers: { cookie: browserHolding(tenantName, [older, newer]) },
    });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Sign out?</title>');
    expect(confirmationFields(page).session_id).toBe(olderId);
    expect(await sessionIsLive(tenantId, olderId)).toBe(true);
    expect(await sessionIsLive(tenantId, sessionIdFromCookie(newer))).toBe(true);
  });

  it.each([
    ['an hour', AN_HOUR],
    ['three years', THREE_YEARS],
  ])('ends the session once confirmed, for a hint expired %s ago', async (_name, expiredFor) => {
    const tenantName = `logout-lapsed-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const cookie = await signIn(tenantName);
    const sessionId = sessionIdFromCookie(cookie);
    const hint = await mintHint(tenantName, await subjectIdOf(tenantId, USERNAME), {
      sid: sessionId,
      expiredFor,
    });

    const res = await getAndConfirm(tenantName, cookie, { id_token_hint: hint, ...END_PARAMS });

    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(POST_LOGOUT_REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('st');
    expect(await sessionIsLive(tenantId, sessionId)).toBe(false);
  });

  it('leaves the same audit row an unexpired hint leaves', async () => {
    const tenantName = `logout-lapsed-audit-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const lapsedCookie = await signIn(tenantName);
    const liveCookie = await signIn(tenantName);
    const lapsedId = sessionIdFromCookie(lapsedCookie);
    const liveId = sessionIdFromCookie(liveCookie);

    await getAndConfirm(tenantName, lapsedCookie, {
      id_token_hint: await mintHint(tenantName, subjectId, { sid: lapsedId, expiredFor: 60 }),
      ...END_PARAMS,
    });
    await getAndConfirm(tenantName, liveCookie, {
      id_token_hint: await mintHint(tenantName, subjectId, { sid: liveId }),
      ...END_PARAMS,
    });

    const expected = [{ detail: { via: 'logout' }, outcome: 'allowed' }];
    expect(await endedAuditRows(tenantId, lapsedId)).toEqual(expected);
    expect(await endedAuditRows(tenantId, liveId)).toEqual(expected);
  });

  it('ends the session the hint names, not the most recently active one, in a browser holding two', async () => {
    const tenantName = `logout-lapsed-two-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const older = await signIn(tenantName);
    const newer = await signIn(tenantName);
    const olderId = sessionIdFromCookie(older);
    const newerId = sessionIdFromCookie(newer);
    const hint = await mintHint(tenantName, subjectId, { sid: olderId, expiredFor: AN_HOUR });
    // One browser holding both: the entries joined the way sessionCookies
    // joins a list (session-cookie.ts's SEPARATOR).
    const bothCookie = `${tenantName}-session=${older.split('=')[1] ?? ''}.${newer.split('=')[1] ?? ''}`;

    const res = await getAndConfirm(tenantName, bothCookie, { id_token_hint: hint, ...END_PARAMS });

    expect(res.statusCode).toBe(302);
    expect(await sessionIsLive(tenantId, olderId)).toBe(false);
    expect(await sessionIsLive(tenantId, newerId)).toBe(true);
  });
});

// One browser holding several sessions, the last signed in being the one
// mostRecentlyActive picks when a hint names nothing usable.
function browserHolding(tenantName: string, cookies: string[]): string {
  return `${tenantName}-session=${cookies.map((cookie) => cookie.split('=')[1] ?? '').join('.')}`;
}

describe('a hint past its exp that does not name the live session still asks', () => {
  // The page asks about `expectedSessionId`, the most recent live session:
  // a hint that was accepted would have named another.
  async function expectConfirmation(
    tenantName: string,
    tenantId: string,
    cookie: string,
    hint: string,
    expectedSessionId: string,
    survivors: string[],
    params: Record<string, string> = END_PARAMS,
  ): Promise<void> {
    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint, ...params }),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(confirmationFields(res).session_id).toBe(expectedSessionId);
    for (const id of survivors) expect(await sessionIsLive(tenantId, id)).toBe(true);
  }

  it('when its sid is a session that already ended', async () => {
    const tenantName = `logout-lapsed-ended-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const first = await signIn(tenantName);
    const hint = await mintHint(tenantName, subjectId, {
      sid: sessionIdFromCookie(first),
      expiredFor: AN_HOUR,
    });
    await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).end(sessionIdFromCookie(first), new Date()),
    );
    const second = await signIn(tenantName);
    const third = await signIn(tenantName);
    const ids = [sessionIdFromCookie(second), sessionIdFromCookie(third)];

    await expectConfirmation(
      tenantName,
      tenantId,
      browserHolding(tenantName, [second, third]),
      hint,
      ids[1] ?? '',
      ids,
    );
  });

  it('when its sid names a session this browser does not hold', async () => {
    const tenantName = `logout-lapsed-other-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const elsewhere = await signIn(tenantName);
    const hereOlder = await signIn(tenantName);
    const hereNewer = await signIn(tenantName);
    const hint = await mintHint(tenantName, subjectId, {
      sid: sessionIdFromCookie(elsewhere),
      expiredFor: AN_HOUR,
    });
    const ids = [elsewhere, hereOlder, hereNewer].map(sessionIdFromCookie);

    await expectConfirmation(
      tenantName,
      tenantId,
      browserHolding(tenantName, [hereOlder, hereNewer]),
      hint,
      ids[2] ?? '',
      ids,
    );
  });

  it('when it carries no sid', async () => {
    const tenantName = `logout-lapsed-nosid-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const older = await signIn(tenantName);
    const newer = await signIn(tenantName);
    const hint = await mintHint(tenantName, await subjectIdOf(tenantId, USERNAME), {
      expiredFor: AN_HOUR,
    });
    const ids = [older, newer].map(sessionIdFromCookie);

    await expectConfirmation(
      tenantName,
      tenantId,
      browserHolding(tenantName, [older, newer]),
      hint,
      ids[1] ?? '',
      ids,
    );
  });

  it('when the browser holds no session cookie at all', async () => {
    const tenantName = `logout-lapsed-nocookie-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const cookie = await signIn(tenantName);
    const hint = await mintHint(tenantName, await subjectIdOf(tenantId, USERNAME), {
      sid: sessionIdFromCookie(cookie),
      expiredFor: AN_HOUR,
    });

    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint, client_id: CLIENT_ID }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Already signed out</title>');
    expect(confirmationFields(res).session_id).toBeUndefined();
    expect(await sessionIsLive(tenantId, sessionIdFromCookie(cookie))).toBe(true);
  });
});

describe('a hint past its exp is no hint when anything else about it is wrong', () => {
  type Spoil = (ctx: {
    tenantName: string;
    subjectId: string;
    sid: string;
    otherTenant: string;
    retiredKey: SigningKeyRecord;
  }) => Promise<string>;

  const lapsed = { expiredFor: AN_HOUR };

  const cases: [string, Spoil][] = [
    [
      'a forged signature',
      async ({ tenantName, subjectId, sid }) => {
        const real = signingKeyOf.get(tenantName);
        if (real === undefined) throw new Error('no key');
        const generated = await generateSigningKey('ES256', KEK);
        const forger: SigningKeyRecord = { ...real, ...generated, kid: real.kid };
        return mintHint(tenantName, subjectId, { sid, key: forger, ...lapsed });
      },
    ],
    [
      'a wrong issuer',
      ({ tenantName, subjectId, sid }) =>
        mintHint(tenantName, subjectId, {
          sid,
          claims: { iss: 'https://elsewhere.example/tenants/x' },
          ...lapsed,
        }),
    ],
    [
      'an explicit typ',
      ({ tenantName, subjectId, sid }) =>
        mintHint(tenantName, subjectId, { sid, typ: 'at+jwt', ...lapsed }),
    ],
    [
      'a different audience than client_id',
      ({ tenantName, subjectId, sid }) =>
        mintHint(tenantName, subjectId, { sid, aud: 'some-other-client', ...lapsed }),
    ],
    [
      'no sub',
      ({ tenantName, sid }) =>
        mintHint(tenantName, 'unused', { sid, claims: { sub: undefined }, ...lapsed }),
    ],
    [
      'no exp',
      ({ tenantName, subjectId, sid }) =>
        mintHint(tenantName, subjectId, { sid, claims: { exp: undefined }, ...lapsed }),
    ],
    [
      'another tenant as its signer and issuer',
      ({ otherTenant, subjectId, sid }) => mintHint(otherTenant, subjectId, { sid, ...lapsed }),
    ],
    [
      'a retired signing key',
      ({ tenantName, subjectId, sid, retiredKey }) =>
        mintHint(tenantName, subjectId, { sid, key: retiredKey, ...lapsed }),
    ],
    [
      'alg none',
      async ({ tenantName, subjectId, sid }) => {
        const base = await mintHint(tenantName, subjectId, { sid, ...lapsed });
        const payload = base.split('.')[1] ?? '';
        const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
        return `${header}.${payload}.`;
      },
    ],
  ];

  it.each(cases)('asks for confirmation and ends nothing: %s', async (_name, spoil) => {
    const tenantName = `logout-spoiled-${newId()}`;
    const otherTenant = `logout-spoiled-other-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    await setupTenant(otherTenant);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    // The hint names the older session; rejected, it leaves the page asking
    // about the newer, which an accepted one would not.
    const older = await signIn(tenantName);
    const newer = await signIn(tenantName);
    const cookie = browserHolding(tenantName, [older, newer]);
    const sid = sessionIdFromCookie(older);
    const newerId = sessionIdFromCookie(newer);

    const generated = await generateSigningKey('ES256', KEK);
    const retiredKey: SigningKeyRecord = {
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'retired',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    await withTenant(app.db, tenantId, (tx) =>
      tx.insert(signingKeys).values({
        id: retiredKey.id,
        tenantId,
        kid: retiredKey.kid,
        alg: retiredKey.alg,
        status: 'retired',
        publicJwk: retiredKey.publicJwk,
        privateJwkEncrypted: retiredKey.privateJwkEncrypted,
      }),
    );

    const hint = await spoil({ tenantName, subjectId, sid, otherTenant, retiredKey });
    const res = await http.inject({
      url: logoutUrl(tenantName, { id_token_hint: hint, ...END_PARAMS }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Sign out?</title>');
    expect(res.headers.location).toBeUndefined();
    expect(confirmationFields(res).session_id).toBe(newerId);
    expect(await sessionIsLive(tenantId, sid)).toBe(true);
    expect(await sessionIsLive(tenantId, newerId)).toBe(true);
  });
});
