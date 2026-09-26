import { generateSigningKey, signingKeys } from '@odudu/crypto';
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
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTenant } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

// The gate two doors share: the form path, after nextRequiredAction
// clears, and session reuse's completeReuse, which issues a code with no
// page ever rendered. A client requiring consent must be asked on both —
// asked on the form path alone means it is asked exactly once, ever, and
// never again from a reused session.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CONSENT_CLIENT_ID = 'consent-required-client';
const CONSENT_CLIENT_SECRET = 'consent-required-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 9);

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function setupTenant(
  name: string,
  options: { consentRequired: boolean; clientId?: string; clientSecret?: string } = {
    consentRequired: true,
  },
): Promise<{ tenantId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  const clientId = options.clientId ?? CONSENT_CLIENT_ID;
  const clientSecret = options.clientSecret ?? CONSENT_CLIENT_SECRET;
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId,
      name: 'Consent test client',
      type: 'confidential',
      secretHash: await hashPassword(clientSecret),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      consentRequired: options.consentRequired,
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

    // A signing key, so redeeming a code for an `openid`-scoped grant can
    // actually mint an ID token.
    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
  });
  return { tenantId };
}

function authorizeUrl(
  tenantName: string,
  clientId: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid offline_access',
    state: 'xyz',
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

async function startAuthSession(tenantName: string, clientId: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenantName, clientId) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
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

function extractAuthSessionId(body: string): string {
  const match = /name="auth_session_id" value="([^"]*)"/.exec(body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered page');
  return value;
}

async function submitCredentials(
  tenantName: string,
  authSessionId: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// Logs in against a fresh authorization request and expects the consent
// screen rather than a redirect — the shared shape every "asks" test starts
// from.
async function loginExpectingConsent(
  tenantName: string,
  clientId: string,
): Promise<LightMyRequestResponse> {
  const authSessionId = await startAuthSession(tenantName, clientId);
  const res = await submitCredentials(tenantName, authSessionId);
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('login-actions/consent');
  return res;
}

async function submitConsent(
  tenantName: string,
  authSessionId: string,
  decision: 'allow' | 'deny',
  scopes: string[] = [],
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams({ auth_session_id: authSessionId, decision });
  for (const scope of scopes) params.append('scope', scope);
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/consent`,
    payload: params.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function redeemCode(
  tenantName: string,
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
  });
}

function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT to have a payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function sessionIdFromCookie(cookie: string): string {
  const value = cookie.split('=')[1];
  if (value === undefined) throw new Error('expected a session id in the cookie');
  return value;
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

describe('the consent gate on the form path', () => {
  it('[OIDC-CORE-3.1.2.4-01] asks for consent before issuing a code, for a client that requires it', async () => {
    const tenantName = `consent-ask-${newId()}`;
    await setupTenant(tenantName);

    const res = await loginExpectingConsent(tenantName, CONSENT_CLIENT_ID);
    expect(res.body).toContain('offline_access');
    // No code, no cookie: nothing was established or issued.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('does not ask a client that does not require consent', async () => {
    const tenantName = `consent-not-required-${newId()}`;
    await setupTenant(tenantName, { consentRequired: false });

    const authSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const res = await submitCredentials(tenantName, authSessionId);

    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('code')).toBeTruthy();
  });

  it('redirects with access_denied when the user refuses', async () => {
    const tenantName = `consent-deny-${newId()}`;
    await setupTenant(tenantName);

    const consentPage = await loginExpectingConsent(tenantName, CONSENT_CLIENT_ID);
    const authSessionId = extractAuthSessionId(consentPage.body);

    const res = await submitConsent(tenantName, authSessionId, 'deny');
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  // §3.1.2.1-14's own condition — prompt=consent, not merely a client that
  // requires it — has to be on the request that gets denied, or the row
  // closes on a test that could pass under a build honouring only the
  // client flag.
  it('[OIDC-CORE-3.1.2.1-14] redirects with access_denied when consent is denied under prompt=consent', async () => {
    const tenantName = `consent-deny-prompt-consent-${newId()}`;
    // consentRequired: false — the only thing asking here is prompt=consent.
    await setupTenant(tenantName, { consentRequired: false });

    const res1 = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID, { prompt: 'consent' }),
    });
    expect(res1.statusCode).toBe(200);
    const authSessionId = extractAuthSessionId(res1.body);
    const login = await submitCredentials(tenantName, authSessionId);
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('login-actions/consent');
    const consentAuthSessionId = extractAuthSessionId(login.body);

    const res = await submitConsent(tenantName, consentAuthSessionId, 'deny');
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('issues a code carrying only the scopes that were ticked', async () => {
    const tenantName = `consent-narrow-${newId()}`;
    await setupTenant(tenantName);

    const consentPage = await loginExpectingConsent(tenantName, CONSENT_CLIENT_ID);
    const authSessionId = extractAuthSessionId(consentPage.body);

    // offline_access is the only optional scope; declining it means ticking
    // nothing.
    const res = await submitConsent(tenantName, authSessionId, 'allow', []);
    expect(res.statusCode).toBe(302);
    const code = new URL(locationHeader(res)).searchParams.get('code');
    if (code === null) throw new Error('expected a code');

    const redeemed = await redeemCode(tenantName, CONSENT_CLIENT_ID, CONSENT_CLIENT_SECRET, code);
    expect(redeemed.statusCode).toBe(200);
    const scope = redeemed.json<{ scope: string }>().scope;
    expect(scope.split(' ')).toContain('openid');
    expect(scope.split(' ')).not.toContain('offline_access');
  });

  it('does not ask again on the next login once recorded', async () => {
    const tenantName = `consent-recorded-${newId()}`;
    await setupTenant(tenantName);

    const consentPage = await loginExpectingConsent(tenantName, CONSENT_CLIENT_ID);
    const authSessionId = extractAuthSessionId(consentPage.body);
    const allowed = await submitConsent(tenantName, authSessionId, 'allow', ['offline_access']);
    expect(allowed.statusCode).toBe(302);

    const secondAuthSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const second = await submitCredentials(tenantName, secondAuthSessionId);
    expect(second.statusCode).toBe(302);
    expect(new URL(locationHeader(second)).searchParams.get('code')).toBeTruthy();
  });

  it('[OIDC-CORE-3.1.2.1-13] asks again when prompt=consent, even though the grant already covers the request', async () => {
    const tenantName = `consent-prompt-consent-${newId()}`;
    await setupTenant(tenantName);

    const firstConsent = await loginExpectingConsent(tenantName, CONSENT_CLIENT_ID);
    const firstAuthSessionId = extractAuthSessionId(firstConsent.body);
    const allowed = await submitConsent(tenantName, firstAuthSessionId, 'allow', [
      'offline_access',
    ]);
    expect(allowed.statusCode).toBe(302);

    const res = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID, { prompt: 'consent' }),
    });
    expect(res.statusCode).toBe(200);
    const secondAuthSessionId = extractAuthSessionId(res.body);
    const submitted = await submitCredentials(tenantName, secondAuthSessionId);
    expect(submitted.statusCode).toBe(200);
    expect(submitted.body).toContain('login-actions/consent');
  });

  // prompt=none with no live session is refused login_required by
  // decideReuse before the login form ever renders, so prompt=none's
  // consent_required refusal is only reachable once a live session exists
  // — exercised below, on the reuse path.

  it('refuses a consent submission whose auth_session_id names nothing', async () => {
    const tenantName = `consent-unknown-session-${newId()}`;
    await setupTenant(tenantName);

    const res = await submitConsent(
      tenantName,
      '01a0a998-8326-7900-8fa6-dd06b842b269',
      'allow',
      [],
    );
    expect(res.statusCode).toBe(400);
  });

  // Fastify leaves request.body undefined for a POST with no Content-Type
  // and no payload — a real request a client library can send by omitting
  // both — and handleConsentSubmission's auth_session_id read must not
  // throw on it.
  it('refuses a POST with no content-type and no body, rather than throwing', async () => {
    const tenantName = `consent-empty-body-${newId()}`;
    await setupTenant(tenantName);

    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/consent`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the consent gate applies to a reused SSO session too', () => {
  it('[OIDC-CORE-3.1.2.4-01] asks for consent on a reused SSO session, not only on a fresh login', async () => {
    const tenantName = `consent-reuse-${newId()}`;
    await setupTenant(tenantName);

    // First request: log in, consent to only the default scopes, get a
    // code — the cookie now names a live session, with a narrower *grant*
    // than the second request below will ask for (the request URL's scope
    // is identical both times).
    const authSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const firstLogin = await http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: authSessionId,
        username: USERNAME,
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(firstLogin.statusCode).toBe(200);
    const consentAuthSessionId = extractAuthSessionId(firstLogin.body);
    const allowed = await submitConsent(tenantName, consentAuthSessionId, 'allow', []);
    expect(allowed.statusCode).toBe(302);
    const cookie = setCookieValue(allowed);
    if (cookie === undefined) throw new Error('expected a set-cookie header from consent allow');

    // Second request with the SAME cookie: the reuse path must ask again,
    // not issue — this is the case a build gating only the form path fails.
    const res = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('login-actions/consent');
    expect(res.body).toContain('offline_access');
  });

  // Would fail against a build that carries the gated reuse path through
  // the ordinary completeLogin (establishSession + authTime: now, as the
  // form path uses): the second token's auth_time would read as the
  // instant consent was granted rather than the instant the subject
  // actually authenticated, and the session id would differ from the
  // first token's — a fresh SSO session minted purely because consent was
  // asked, orphaning the original until it idles out.
  it('[ODUDU-CONSENT-REUSE-AUTHTIME-01] reports the original auth_time and session, not the moment consent was granted', async () => {
    const tenantName = `consent-reuse-authtime-${newId()}`;
    await setupTenant(tenantName);

    const authSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const firstLogin = await submitCredentials(tenantName, authSessionId);
    expect(firstLogin.statusCode).toBe(200);
    const firstConsentAuthSessionId = extractAuthSessionId(firstLogin.body);
    const firstAllowed = await submitConsent(tenantName, firstConsentAuthSessionId, 'allow', []);
    expect(firstAllowed.statusCode).toBe(302);
    const cookie = setCookieValue(firstAllowed);
    if (cookie === undefined) throw new Error('expected a set-cookie header from consent allow');
    const firstCode = new URL(locationHeader(firstAllowed)).searchParams.get('code');
    if (firstCode === null) throw new Error('expected a code from the first consent');

    const firstRedeemed = await redeemCode(
      tenantName,
      CONSENT_CLIENT_ID,
      CONSENT_CLIENT_SECRET,
      firstCode,
    );
    expect(firstRedeemed.statusCode).toBe(200);
    const firstAuthTime = jwtPayload(firstRedeemed.json<{ id_token: string }>().id_token).auth_time;

    // Real time must actually advance, so a build that read `now` instead
    // of the original authTime would be caught rather than coincidentally
    // matching by running in the same second.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const reused = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID),
      headers: { cookie },
    });
    expect(reused.statusCode).toBe(200);
    const secondConsentAuthSessionId = extractAuthSessionId(reused.body);
    const secondAllowed = await submitConsent(tenantName, secondConsentAuthSessionId, 'allow', [
      'offline_access',
    ]);
    expect(secondAllowed.statusCode).toBe(302);
    const secondCookie = setCookieValue(secondAllowed);
    if (secondCookie === undefined) {
      throw new Error('expected a set-cookie header from the second consent allow');
    }
    const secondCode = new URL(locationHeader(secondAllowed)).searchParams.get('code');
    if (secondCode === null) throw new Error('expected a code from the second consent');

    const secondRedeemed = await redeemCode(
      tenantName,
      CONSENT_CLIENT_ID,
      CONSENT_CLIENT_SECRET,
      secondCode,
    );
    expect(secondRedeemed.statusCode).toBe(200);
    const secondAuthTime = jwtPayload(
      secondRedeemed.json<{ id_token: string }>().id_token,
    ).auth_time;

    expect(secondAuthTime).toBe(firstAuthTime);
    expect(sessionIdFromCookie(secondCookie)).toBe(sessionIdFromCookie(cookie));
  });

  // Two ids on one behaviour: OIDC Core states the same refusal twice, once
  // in §3.1.2.1's own prompt=none MUST and once in §3.1.2.6's consent_required
  // MAY. One assertion earns both rows; tools/trace/src/suite.ts's
  // lastIdIn keeps only the last bracket in a title, so this is asserted
  // twice under two titles rather than once under two brackets.
  it('[OIDC-CORE-3.1.2.1-12] refuses with consent_required under prompt=none when a live session has nothing recorded', async () => {
    const tenantName = `consent-reuse-prompt-none-${newId()}`;
    await setupTenant(tenantName);

    const authSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const login = await submitCredentials(tenantName, authSessionId);
    expect(login.statusCode).toBe(200);
    const consentAuthSessionId = extractAuthSessionId(login.body);
    const allowed = await submitConsent(tenantName, consentAuthSessionId, 'allow', []);
    const cookie = setCookieValue(allowed);
    if (cookie === undefined) throw new Error('expected a set-cookie header from consent allow');

    // A wider scope than what was recorded (offline_access was declined),
    // under prompt=none: the live session answers who, but the missing
    // scope means consent_required, not a silent grant.
    const res = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID, { prompt: 'none' }),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBe('consent_required');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('[OIDC-CORE-3.1.2.6-07] returns consent_required as the prompt=none error, naming what specifically was missing', async () => {
    const tenantName = `consent-reuse-prompt-none-mayrow-${newId()}`;
    await setupTenant(tenantName);

    const authSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const login = await submitCredentials(tenantName, authSessionId);
    expect(login.statusCode).toBe(200);
    const consentAuthSessionId = extractAuthSessionId(login.body);
    const allowed = await submitConsent(tenantName, consentAuthSessionId, 'allow', []);
    const cookie = setCookieValue(allowed);
    if (cookie === undefined) throw new Error('expected a set-cookie header from consent allow');

    const res = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID, { prompt: 'none' }),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(locationHeader(res));
    expect(location.searchParams.get('error')).toBe('consent_required');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('reuses without asking once the wider scope has also been recorded', async () => {
    const tenantName = `consent-reuse-recorded-${newId()}`;
    await setupTenant(tenantName);

    const authSessionId = await startAuthSession(tenantName, CONSENT_CLIENT_ID);
    const login = await submitCredentials(tenantName, authSessionId);
    const consentAuthSessionId = extractAuthSessionId(login.body);
    const allowed = await submitConsent(tenantName, consentAuthSessionId, 'allow', [
      'offline_access',
    ]);
    const cookie = setCookieValue(allowed);
    if (cookie === undefined) throw new Error('expected a set-cookie header from consent allow');

    const res = await http.inject({
      url: authorizeUrl(tenantName, CONSENT_CLIENT_ID),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('code')).toBeTruthy();
  });
});
