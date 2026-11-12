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
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessions, provisionTenant } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { noBreachedLookup } from '#/testing/breached-check';

// Initiating User Registration via OpenID Connect 1.0 §4: `prompt=create`
// asks for the account creation page instead of the login. The request is
// parked exactly as a login would park it, and the browser is sent to the
// registration page the sign-in form's own link leads to, carrying the way
// back. A tenant that serves no registration page refuses the value as one
// it does not support (§4.1), which its discovery document also says (§4.2).

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'prompt-create-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'alice';
const PASSWORD = 'correct horse battery staple';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'app-state-1';
const NONCE = 'app-nonce-1';
const KEK = Buffer.alloc(32, 9);

const signingKeyOf = new Map<string, SigningKeyRecord>();

async function setupTenant(
  name: string,
  settings: { registrationAllowed: boolean },
): Promise<{ tenantId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name,
      registrationAllowed: settings.registrationAllowed,
    });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Prompt-create test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
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
    // A signing key, so an id_token_hint minted for this tenant verifies the
    // way one /token issued would.
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
  return { tenantId };
}

async function issuerOf(tenantName: string): Promise<string> {
  const res = await http.inject({ url: `/tenants/${tenantName}/.well-known/openid-configuration` });
  return res.json<{ issuer: string }>().issuer;
}

async function mintIdToken(tenantName: string, sub: string): Promise<string> {
  const key = signingKeyOf.get(tenantName);
  if (key === undefined) throw new Error(`no signing key for ${tenantName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { iss: await issuerOf(tenantName), aud: CLIENT_ID, sub, iat: now, exp: now + 300 },
    { key, kek: KEK },
  );
}

function authorizeUrl(
  tenantName: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: STATE,
    nonce: NONCE,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

function locationOf(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

function setCookies(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

function signInCookie(res: LightMyRequestResponse): string {
  const pair = setCookies(res)
    .map((value) => value.split(';')[0] ?? '')
    .find((value) => value.startsWith('odudu-sign-in='));
  if (pair === undefined) throw new Error('no sign-in cookie was set');
  return pair;
}

function authSessionIdOf(body: string): string {
  const id = /name="auth_session_id" value="([^"]*)"/u.exec(body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

async function parkedRequest(authSessionId: string): Promise<Record<string, unknown>> {
  const [row] = await owner.db
    .select({ pending: authenticationSessions.pendingRequest })
    .from(authenticationSessions)
    .where(eq(authenticationSessions.id, authSessionId));
  if (row?.pending === null || row?.pending === undefined) {
    throw new Error('nothing parked on that session');
  }
  return row.pending as Record<string, unknown>;
}

async function parkedSessionCount(tenantId: string): Promise<number> {
  const rows = await owner.db
    .select({ id: authenticationSessions.id })
    .from(authenticationSessions)
    .where(eq(authenticationSessions.tenantId, tenantId));
  return rows.length;
}

// The redirect's query, with `error_description` read the way a client
// reads it: already decoded.
function redirectedError(res: LightMyRequestResponse): Record<string, string> {
  expect(res.statusCode).toBe(302);
  const target = new URL(locationOf(res));
  expect(`${target.origin}${target.pathname}`).toBe(REDIRECT_URI);
  return Object.fromEntries(target.searchParams);
}

// The registration page the browser is sent to, and the sign-in path it
// carries, read back out of the Location header.
function registrationTarget(res: LightMyRequestResponse): { path: string; returnTo: URL } {
  expect(res.statusCode).toBe(303);
  const location = locationOf(res);
  const url = new URL(location, 'https://this.server.example');
  expect(location.startsWith('/')).toBe(true);
  const returnTo = url.searchParams.get('return_to');
  if (returnTo === null) throw new Error('the registration page was given no way back');
  return { path: url.pathname, returnTo: new URL(returnTo, 'https://this.server.example') };
}

async function signIn(tenantName: string): Promise<string> {
  const started = await http.inject({ url: authorizeUrl(tenantName, { prompt: 'login' }) });
  expect(started.statusCode).toBe(200);
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionIdOf(started.body),
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(302);
  return setCookies(res)
    .map((value) => value.split(';')[0] ?? '')
    .filter((value) => !value.endsWith('='))
    .join('; ');
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(containerHandle.adminUrl);
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
      kek: Buffer.alloc(32, 9),
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

describe('[OIDC-PROMPT-CREATE-4.1-01] prompt=create shows the registration page, not the login', () => {
  it('parks the request and sends the browser to the registration page, with the way back', async () => {
    const tenantName = `create-open-${newId()}`;
    const { tenantId } = await setupTenant(tenantName, { registrationAllowed: true });
    const before = await parkedSessionCount(tenantId);

    const res = await http.inject({ url: authorizeUrl(tenantName, { prompt: 'create' }) });

    const { path, returnTo } = registrationTarget(res);
    expect(path).toBe(`/tenants/${tenantName}/login-actions/registration`);
    expect(res.body).not.toContain('auth_session_id');

    // The way back is this tenant's own authorize path, holding the
    // application's own state, nonce and challenge, and asking for a
    // sign-in: the account the person is about to make, not a session the
    // browser already holds.
    expect(returnTo.pathname).toBe(`/tenants/${tenantName}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(returnTo.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid',
      state: STATE,
      nonce: NONCE,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      prompt: 'login',
    });

    // Parked exactly as a login would park it, with the request as sent, so
    // a verification link mailed from the registration can name it.
    expect(await parkedSessionCount(tenantId)).toBe(before + 1);
    const cookie = signInCookie(res);
    const authSessionId = cookie.slice('odudu-sign-in='.length).split('.')[0] ?? '';
    expect(await parkedRequest(authSessionId)).toMatchObject({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      prompt: ['create'],
    });
  });

  it('answers the form-encoded POST the same way', async () => {
    const tenantName = `create-post-${newId()}`;
    await setupTenant(tenantName, { registrationAllowed: true });
    const [path, query] = authorizeUrl(tenantName, { prompt: 'create' }).split('?');

    const res = await http.inject({
      method: 'POST',
      url: path ?? '',
      payload: query ?? '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(registrationTarget(res).path).toBe(`/tenants/${tenantName}/login-actions/registration`);
  });

  // §4.1 leaves whether a new identity is created or an existing one
  // authenticated out of scope. The client asked for the registration page,
  // so a browser already signed in as somebody is shown it too, and no code
  // is issued from the session it holds.
  it('shows the registration page to a browser that already holds a session', async () => {
    const tenantName = `create-signed-in-${newId()}`;
    await setupTenant(tenantName, { registrationAllowed: true });
    const cookie = await signIn(tenantName);
    const reused = await http.inject({ url: authorizeUrl(tenantName), headers: { cookie } });
    expect(new URL(locationOf(reused)).searchParams.has('code')).toBe(true);

    const res = await http.inject({
      url: authorizeUrl(tenantName, { prompt: 'create' }),
      headers: { cookie },
    });

    expect(registrationTarget(res).path).toBe(`/tenants/${tenantName}/login-actions/registration`);
    expect(locationOf(res)).not.toContain('code=');
  });

  // Above the §4.1.2.1 boundary nothing changes: with no client to trust a
  // redirect_uri against, the refusal is a page, and no registration page
  // is offered for a request that could never come back from it.
  it('renders the usual error page for an unknown client, whatever the prompt', async () => {
    const tenantName = `create-unknown-client-${newId()}`;
    await setupTenant(tenantName, { registrationAllowed: true });

    const res = await http.inject({
      url: authorizeUrl(tenantName, { prompt: 'create', client_id: 'nobody' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('[OIDC-PROMPT-CREATE-4.1-02] a tenant with registration off refuses prompt=create', () => {
  it('redirects with invalid_request, a fixed description, and parks nothing', async () => {
    const tenantName = `create-closed-${newId()}`;
    const { tenantId } = await setupTenant(tenantName, { registrationAllowed: false });
    const before = await parkedSessionCount(tenantId);

    const res = await http.inject({ url: authorizeUrl(tenantName, { prompt: 'create' }) });

    const discovery = await http.inject({
      url: `/tenants/${tenantName}/.well-known/openid-configuration`,
    });
    expect(redirectedError(res)).toEqual({
      error: 'invalid_request',
      error_description: 'prompt=create is not supported: registration is off',
      state: STATE,
      iss: discovery.json<{ issuer: string }>().issuer,
    });
    expect(setCookies(res)).toEqual([]);
    expect(await parkedSessionCount(tenantId)).toBe(before);
  });

  it('still shows that tenant its login page without the value', async () => {
    const tenantName = `create-closed-login-${newId()}`;
    await setupTenant(tenantName, { registrationAllowed: false });

    const res = await http.inject({ url: authorizeUrl(tenantName) });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
  });
});

// A hint or a `claims` `sub` names an existing End-User the response must
// be for (OIDC Core §3.1.2.2); a new account can never be that person, and
// the hint is not parked, so a way back could not carry it. Refused rather
// than sending someone to a page they could not return from.
describe('[OIDC-PROMPT-CREATE-4-01] create is refused beside a hint or a claims sub', () => {
  it('refuses prompt=create with an id_token_hint this tenant issued', async () => {
    const tenantName = `create-hinted-${newId()}`;
    const { tenantId } = await setupTenant(tenantName, { registrationAllowed: true });
    const before = await parkedSessionCount(tenantId);
    const hint = await mintIdToken(tenantName, newId());

    const res = await http.inject({
      url: authorizeUrl(tenantName, { prompt: 'create', id_token_hint: hint }),
    });

    expect(redirectedError(res)).toMatchObject({
      error: 'invalid_request',
      error_description: 'prompt=create cannot be sent with id_token_hint or a claims sub',
      state: STATE,
    });
    expect(await parkedSessionCount(tenantId)).toBe(before);
  });

  it('refuses prompt=create with a claims parameter naming a sub', async () => {
    const tenantName = `create-claims-sub-${newId()}`;
    await setupTenant(tenantName, { registrationAllowed: true });

    const res = await http.inject({
      url: authorizeUrl(tenantName, {
        prompt: 'create',
        claims: JSON.stringify({ id_token: { sub: { value: newId() } } }),
      }),
    });

    expect(redirectedError(res)).toMatchObject({
      error: 'invalid_request',
      error_description: 'prompt=create cannot be sent with id_token_hint or a claims sub',
    });
  });
});

describe('[OIDC-PROMPT-CREATE-4-01] create travels alone', () => {
  it.each([
    'create login',
    'login create',
    'create consent',
    'create select_account',
    'none create',
  ])(
    'refuses prompt=%o as invalid_request, even where create alone would be served',
    async (prompt) => {
      const tenantName = `create-combined-${newId()}`;
      await setupTenant(tenantName, { registrationAllowed: true });

      const res = await http.inject({ url: authorizeUrl(tenantName, { prompt }) });

      expect(redirectedError(res)).toMatchObject({
        error: 'invalid_request',
        error_description: 'prompt is not valid',
        state: STATE,
      });
    },
  );
});

describe('[OIDC-PROMPT-CREATE-4.2-01] discovery says which tenants serve it', () => {
  it('lists create for a tenant with registration on, and not for one without', async () => {
    const open = `create-discovery-open-${newId()}`;
    const closed = `create-discovery-closed-${newId()}`;
    await setupTenant(open, { registrationAllowed: true });
    await setupTenant(closed, { registrationAllowed: false });

    const openDoc = await http.inject({ url: `/tenants/${open}/.well-known/openid-configuration` });
    const closedDoc = await http.inject({
      url: `/tenants/${closed}/.well-known/openid-configuration`,
    });

    expect(openDoc.json<{ prompt_values_supported: string[] }>().prompt_values_supported).toEqual([
      'none',
      'login',
      'consent',
      'select_account',
      'create',
    ]);
    expect(closedDoc.json<{ prompt_values_supported: string[] }>().prompt_values_supported).toEqual(
      ['none', 'login', 'consent', 'select_account'],
    );
  });
});

describe('prompt=create stays inside the tenant the request names', () => {
  it('refuses, as a page, a client of one tenant used at another, however open that one is', async () => {
    const home = `create-home-${newId()}`;
    const other = `create-other-${newId()}`;
    await setupTenant(home, { registrationAllowed: false });
    await setupTenant(other, { registrationAllowed: true });

    // Both tenants register the same client_id, so the client resolves in
    // each; the redirect names the tenant of the path, never another.
    const res = await http.inject({ url: authorizeUrl(other, { prompt: 'create' }) });
    expect(registrationTarget(res).path).toBe(`/tenants/${other}/login-actions/registration`);

    const foreign = await http.inject({
      url: authorizeUrl(`no-such-tenant-${newId()}`, { prompt: 'create' }),
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.headers.location).toBeUndefined();
  });
});
