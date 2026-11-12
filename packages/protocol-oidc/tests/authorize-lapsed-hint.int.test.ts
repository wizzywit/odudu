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
import { provisionTenant } from '@odudu/authn-flows';
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
import { noBreachedLookup } from '#/testing/breached-check';

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

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
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

async function signIn(tenantName: string, username: string = USERNAME): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenantName) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found');

  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username,
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
      breachedPasswordCheck: noBreachedLookup,
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

async function addUser(tenantId: string, username: string): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    return subject.id;
  });
}

function authorize(tenantName: string, hint: string, extra: Record<string, string> = {}) {
  return (cookie?: string) =>
    http.inject({
      url: `${authorizeUrl(tenantName)}&${new URLSearchParams({ id_token_hint: hint, ...extra }).toString()}`,
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });
}

function redirectParams(res: LightMyRequestResponse): URLSearchParams {
  return new URL(locationHeader(res)).searchParams;
}

describe('[OIDC-CORE-3.1.2.2-08] /authorize accepts an id_token_hint past its exp, as a constraint only', () => {
  it('reuses the live session of the hint subject, with or without prompt=none', async () => {
    const tenantName = `authz-lapsed-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const adaId = await subjectIdOf(tenantId, USERNAME);
    const cookie = await signIn(tenantName);
    const hint = await mintHint(tenantName, adaId, {
      sid: sessionIdFromCookie(cookie),
      expiredFor: THREE_YEARS,
    });

    for (const extra of [{}, { prompt: 'none' }]) {
      const res = await authorize(tenantName, hint, extra)(cookie);
      expect(res.statusCode).toBe(302);
      expect(redirectParams(res).get('code')).not.toBeNull();
    }
  });

  it('prompt=none with only another subject live is login_required, with no code', async () => {
    const tenantName = `authz-lapsed-other-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const adaId = await subjectIdOf(tenantId, USERNAME);
    await addUser(tenantId, 'bob');
    const bobCookie = await signIn(tenantName, 'bob');
    const hint = await mintHint(tenantName, adaId, { expiredFor: AN_HOUR });

    const res = await authorize(tenantName, hint, { prompt: 'none' })(bobCookie);

    expect(res.statusCode).toBe(302);
    expect(redirectParams(res).get('error')).toBe('login_required');
    expect(redirectParams(res).get('code')).toBeNull();
  });

  it('prompt=none with no session is login_required', async () => {
    const tenantName = `authz-lapsed-nosession-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const hint = await mintHint(tenantName, await subjectIdOf(tenantId, USERNAME), {
      expiredFor: AN_HOUR,
    });

    const res = await authorize(tenantName, hint, { prompt: 'none' })();

    expect(redirectParams(res).get('error')).toBe('login_required');
    expect(redirectParams(res).get('code')).toBeNull();
  });

  it('shows the login form when another subject is live, and that subject cannot sign in through it', async () => {
    const tenantName = `authz-lapsed-form-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const adaId = await subjectIdOf(tenantId, USERNAME);
    await addUser(tenantId, 'bob');
    const bobCookie = await signIn(tenantName, 'bob');
    const hint = await mintHint(tenantName, adaId, { expiredFor: AN_HOUR });

    const res = await authorize(tenantName, hint)(bobCookie);
    expect(res.statusCode).toBe(200);
    const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
    if (authSessionId === undefined) throw new Error('auth_session_id not found');

    const submitted = await http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: authSessionId,
        username: 'bob',
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(submitted.headers.location ?? '').not.toContain('code=');
  });

  type Spoil = (ctx: { tenantName: string; subjectId: string }) => Promise<string>;
  const lapsed = { expiredFor: AN_HOUR };
  const spoiled: [string, Spoil][] = [
    [
      'another audience than the requesting client',
      ({ tenantName, subjectId }) =>
        mintHint(tenantName, subjectId, { aud: 'some-other-client', ...lapsed }),
    ],
    [
      'a wrong issuer',
      ({ tenantName, subjectId }) =>
        mintHint(tenantName, subjectId, {
          claims: { iss: 'https://elsewhere.example' },
          ...lapsed,
        }),
    ],
    [
      'an explicit typ',
      ({ tenantName, subjectId }) => mintHint(tenantName, subjectId, { typ: 'at+jwt', ...lapsed }),
    ],
    [
      'no exp',
      ({ tenantName, subjectId }) =>
        mintHint(tenantName, subjectId, { claims: { exp: undefined }, ...lapsed }),
    ],
    [
      'a forged signature',
      async ({ tenantName, subjectId }) => {
        const real = signingKeyOf.get(tenantName);
        if (real === undefined) throw new Error('no key');
        const generated = await generateSigningKey('ES256', KEK);
        const forger: SigningKeyRecord = { ...real, ...generated, kid: real.kid };
        return mintHint(tenantName, subjectId, { key: forger, ...lapsed });
      },
    ],
  ];

  it.each(spoiled)('still refuses a lapsed hint with %s', async (_name, spoil) => {
    const tenantName = `authz-lapsed-bad-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);
    const subjectId = await subjectIdOf(tenantId, USERNAME);
    const cookie = await signIn(tenantName);

    const res = await authorize(tenantName, await spoil({ tenantName, subjectId }))(cookie);

    expect(res.statusCode).toBe(302);
    expect(redirectParams(res).get('error')).toBe('invalid_request');
    expect(redirectParams(res).get('code')).toBeNull();
  });
});
