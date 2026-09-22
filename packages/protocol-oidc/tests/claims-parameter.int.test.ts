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
import { provisionTenant, requiredActionRepository } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

// OIDC Core §5.5: what a `claims` request carries onto the flow it starts —
// an Essential Claim honoured at ID token issuance, a `sub` that narrows who
// may complete the request (§3.1.2.2), and a `userinfo` member honoured at
// /userinfo, always intersected with the scope actually granted, never a
// path around consent.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

let TENANT: string;
let TENANT_ID: string;

const CLIENT_ID = 'claims-client';
const CLIENT_SECRET = 'claims-client-secret';
const REDIRECT_URI = 'https://app.example/callback';
const KEK = Buffer.alloc(32, 11);
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const ALICE_USERNAME = 'alice';
const ALICE_PASSWORD = 'correct horse battery staple';
const ALICE_EMAIL = 'alice@example.test';
const BOB_USERNAME = 'bob';
const BOB_PASSWORD = 'another horse battery staple';
// One subject per door-coverage test below, each otherwise untouched by
// the rest of the suite, so completing a detour for one (a required
// action, a consent decision) never leaves state a different test trips
// over.
const CAROL_USERNAME = 'carol';
const CAROL_PASSWORD = 'a passphrase carol alone uses';
const DAVE_USERNAME = 'dave';
const DAVE_PASSWORD = 'a passphrase dave alone uses';
const ERIN_USERNAME = 'erin';
const ERIN_PASSWORD = 'a passphrase erin alone uses';
const FRANK_USERNAME = 'frank';
const FRANK_PASSWORD = 'a passphrase frank alone uses';

let aliceSubjectId: string;
let bobSubjectId: string;
let frankSubjectId: string;

async function setupTenant(): Promise<void> {
  TENANT = `claims-parameter-${newId()}`;
  const tenantId = newId();
  TENANT_ID = tenantId;

  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: TENANT });
    await provisionTenant(tx, tenantId);

    const clientDbId = newId();
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Claims parameter test client',
      type: 'confidential',
      secretHash: await hashPassword(CLIENT_SECRET),
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
    });

    const alice = await subjectRepository(tx).create({ tenantId, type: 'user' });
    aliceSubjectId = alice.id;
    await tx.insert(users).values({
      subjectId: alice.id,
      tenantId,
      username: ALICE_USERNAME,
      email: ALICE_EMAIL,
      emailVerified: true,
    });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: alice.id,
      type: 'password',
      secretData: { hash: await hashPassword(ALICE_PASSWORD) },
    });

    const bob = await subjectRepository(tx).create({ tenantId, type: 'user' });
    bobSubjectId = bob.id;
    await tx.insert(users).values({ subjectId: bob.id, tenantId, username: BOB_USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: bob.id,
      type: 'password',
      secretData: { hash: await hashPassword(BOB_PASSWORD) },
    });

    for (const [username, password] of [
      [CAROL_USERNAME, CAROL_PASSWORD],
      [DAVE_USERNAME, DAVE_PASSWORD],
      [ERIN_USERNAME, ERIN_PASSWORD],
      [FRANK_USERNAME, FRANK_PASSWORD],
    ] as const) {
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      if (username === FRANK_USERNAME) frankSubjectId = subject.id;
      await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: await hashPassword(password) },
      });
    }

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
}

function authorizeUrl(overrides: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/tenants/${TENANT}/protocol/openid-connect/auth?${query.toString()}`;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

function cookieHeaderFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const cookies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const header = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  if (header === '') throw new Error('expected a session cookie from a successful login');
  return header;
}

async function authorize(
  overrides: Record<string, string | undefined> = {},
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return http.inject({ url: authorizeUrl(overrides), headers });
}

// A first-time, whole-journey form login for the named credentials, against
// whatever /authorize overrides the caller carries — the door every one of
// the redeemable-flow assertions below runs through.
async function formLogin(
  username: string,
  password: string,
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: string; cookie: string }> {
  const started = await authorize(overrides);
  expect(started.statusCode).toBe(200);

  const sessionId = /name="auth_session_id" value="([^"]*)"/.exec(started.body)?.[1];
  if (sessionId === undefined) throw new Error('no auth_session_id in the rendered login form');

  const form = new URLSearchParams({ auth_session_id: sessionId, username, password });
  const login = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(login.statusCode).toBe(302);
  const code = new URL(locationHeader(login)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');
  return { code, cookie: cookieHeaderFrom(login) };
}

// Signs a second subject in while carrying an existing session cookie
// forward, the way a real browser would — `completeAuthorizedLogin` reads
// the request's own live sessions and adds this login to the set rather
// than replacing it, so the returned cookie names *both* subjects' live
// sessions, each under its own id.
async function signInAdditional(
  existingCookie: string,
  username: string,
  password: string,
): Promise<{ code: string; cookie: string }> {
  const started = await http.inject({
    url: authorizeUrl({ prompt: 'login', code_challenge: CHALLENGE }),
    headers: { cookie: existingCookie },
  });
  expect(started.statusCode).toBe(200);
  const sessionId = /name="auth_session_id" value="([^"]*)"/.exec(started.body)?.[1];
  if (sessionId === undefined) throw new Error('no auth_session_id in the rendered login form');

  const form = new URLSearchParams({ auth_session_id: sessionId, username, password });
  const login = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: existingCookie },
  });
  expect(login.statusCode).toBe(302);
  const code = new URL(locationHeader(login)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');
  return { code, cookie: cookieHeaderFrom(login) };
}

async function redeemCode(code: string): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  return http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
}

function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (segment === undefined) throw new Error('expected a JWT to have a payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

// The whole journey for Alice — form login, then redemption — returning the
// ID token's decoded payload.
async function flow(overrides: Record<string, string | undefined> = {}): Promise<{
  id_token: Record<string, unknown>;
}> {
  const { code } = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {
    code_challenge: CHALLENGE,
    ...overrides,
  });
  const redeemed = await redeemCode(code);
  expect(redeemed.statusCode).toBe(200);
  const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
  if (idToken === undefined) throw new Error('expected an id_token');
  return { id_token: jwtPayload(idToken) };
}

function subClaim(subjectId: string): string {
  return JSON.stringify({ id_token: { sub: { value: subjectId } } });
}

async function userinfoAfter(overrides: {
  claims: string;
  scope: string;
}): Promise<Record<string, unknown>> {
  const { code } = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {
    code_challenge: CHALLENGE,
    claims: overrides.claims,
    scope: overrides.scope,
  });
  const redeemed = await redeemCode(code);
  expect(redeemed.statusCode).toBe(200);
  const { access_token: accessToken } = redeemed.json<{ access_token?: string }>();
  if (accessToken === undefined) throw new Error('expected an access_token');

  const res = await http.inject({
    url: `/tenants/${TENANT}/protocol/openid-connect/userinfo`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

// Door 3 — the account chooser. `prompt=select_account` forces the chooser
// even for the one live session this subject has (decideReuse's own rule),
// so a fresh login here establishes the session and the second request
// drives the chooser's own POST.
async function chooseAccountSelf(
  username: string,
  password: string,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const { cookie } = await formLogin(username, password, { code_challenge: CHALLENGE });
  const select = await authorize(
    { prompt: 'select_account', code_challenge: CHALLENGE, ...overrides },
    { cookie },
  );
  expect(select.statusCode).toBe(200);
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(select.body)?.[1];
  const sessionId = /name="session_id" value="([^"]*)"/.exec(select.body)?.[1];
  if (authSessionId === undefined || sessionId === undefined) {
    throw new Error('expected the chooser page to carry auth_session_id and session_id');
  }
  const form = new URLSearchParams({ auth_session_id: authSessionId, session_id: sessionId });
  const chosen = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/select-account`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
  expect(chosen.statusCode).toBe(302);
  const code = new URL(locationHeader(chosen)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the chooser redirect');
  return code;
}

// Doors 4 and 5 — the consent POST, reached either after a fresh login
// (no live session; `alreadySignedIn` false) or after a live session is
// promoted into a consent decision (`alreadySignedIn` true, a prior
// `formLogin` already established the session `prompt=consent` reuses).
async function completeThroughConsent(
  username: string,
  password: string,
  alreadySignedIn: boolean,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const cookie = alreadySignedIn ? (await formLogin(username, password, {})).cookie : undefined;
  const started = await authorize(
    { prompt: 'consent', code_challenge: CHALLENGE, ...overrides },
    cookie !== undefined ? { cookie } : {},
  );
  expect(started.statusCode).toBe(200);
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(started.body)?.[1];
  if (authSessionId === undefined) throw new Error('no auth_session_id in the rendered page');

  let consentSessionId = authSessionId;
  if (!alreadySignedIn) {
    const form = new URLSearchParams({ auth_session_id: authSessionId, username, password });
    const login = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/login-actions/authenticate`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(login.statusCode).toBe(200);
    const id = /name="auth_session_id" value="([^"]*)"/.exec(login.body)?.[1];
    if (id === undefined) throw new Error('no auth_session_id on the consent page');
    consentSessionId = id;
  }

  const consentForm = new URLSearchParams({ auth_session_id: consentSessionId, decision: 'allow' });
  const consented = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/consent`,
    payload: consentForm.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie !== undefined ? { cookie } : {}),
    },
  });
  expect(consented.statusCode).toBe(302);
  const code = new URL(locationHeader(consented)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the consent redirect');
  return code;
}

// Door 6 — the required-action detour. Completing the owed action re-renders
// the login form against the *same* parked authentication session rather
// than issuing a code directly (view/routes/required-action.ts's own
// comment), so the factor is resubmitted — with the password just set —
// before the flow reaches the same `completeAuthorizedLogin` tail door 2
// does.
async function completeThroughRequiredAction(
  username: string,
  oldPassword: string,
  newPassword: string,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const started = await authorize({ code_challenge: CHALLENGE, ...overrides });
  expect(started.statusCode).toBe(200);
  const firstSessionId = /name="auth_session_id" value="([^"]*)"/.exec(started.body)?.[1];
  if (firstSessionId === undefined) throw new Error('no auth_session_id in the rendered form');

  const loginForm = new URLSearchParams({
    auth_session_id: firstSessionId,
    username,
    password: oldPassword,
  });
  const owed = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/authenticate`,
    payload: loginForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(owed.statusCode).toBe(200);
  expect(owed.body).toContain('Change your password');

  const actionForm = new URLSearchParams({
    auth_session_id: firstSessionId,
    password: newPassword,
  });
  const changed = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/required-action?action=update-password`,
    payload: actionForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(changed.statusCode).toBe(200);
  const resumedSessionId = /name="auth_session_id" value="([^"]*)"/.exec(changed.body)?.[1];
  if (resumedSessionId === undefined) throw new Error('no auth_session_id on the resumed form');

  const secondLogin = new URLSearchParams({
    auth_session_id: resumedSessionId,
    username,
    password: newPassword,
  });
  const finished = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/login-actions/authenticate`,
    payload: secondLogin.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(finished.statusCode).toBe(302);
  const code = new URL(locationHeader(finished)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the resumed login redirect');
  return code;
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

  await setupTenant();

  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[OIDC-CORE-2-09] auth_time is present when requested as an Essential Claim', () => {
  it('includes auth_time in the ID token when requested as essential', async () => {
    const { id_token: idToken } = await flow({
      claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
    });
    expect(idToken.auth_time).toEqual(expect.any(Number));
  });

  it('omits auth_time when it was not requested and max_age was not used', async () => {
    const { id_token: idToken } = await flow({});
    expect('auth_time' in idToken).toBe(false);
  });

  // max_age forcing `auth_time` onto the stored claims request must not
  // narrow away every other scope-granted ID token claim — nothing in the
  // `claims` parameter named any of them, only `max_age` did.
  it('does not narrow other scope-granted ID token claims when max_age alone forced auth_time', async () => {
    const { id_token: idToken } = await flow({ scope: 'openid profile', max_age: '3600' });
    expect(idToken.auth_time).toEqual(expect.any(Number));
    expect(idToken.preferred_username).toBe(ALICE_USERNAME);
  });
});

describe('[OIDC-CORE-3.1.2.2-07] a claims-requested sub decides who may complete the request', () => {
  it('serves the authorization when sub is requested with the value of the live session', async () => {
    const { cookie } = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {
      code_challenge: CHALLENGE,
    });
    const response = await authorize(
      { claims: subClaim(aliceSubjectId), code_challenge: CHALLENGE },
      { cookie },
    );
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('code')).toBeTruthy();
  });

  it('refuses under prompt=none when sub names somebody other than the live session', async () => {
    const { cookie } = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {
      code_challenge: CHALLENGE,
    });
    const response = await authorize(
      { claims: subClaim(bobSubjectId), prompt: 'none', code_challenge: CHALLENGE },
      { cookie },
    );
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('error')).toBe('login_required');
  });

  it('asks for a login when sub names somebody not currently signed in', async () => {
    const { cookie } = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {
      code_challenge: CHALLENGE,
    });
    const response = await authorize(
      { claims: subClaim(bobSubjectId), code_challenge: CHALLENGE },
      { cookie },
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('name="password"');
  });

  // The defect this rule exists to close: the form the previous test shows
  // is not itself the enforcement, only where it starts. Somebody has to
  // actually type credentials into it — Alice's own — for the request to
  // be answerable, and the request named Bob.
  it('refuses when a different subject actually signs in at the form the sub rule produced', async () => {
    const started = await authorize({ claims: subClaim(bobSubjectId), code_challenge: CHALLENGE });
    expect(started.statusCode).toBe(200);
    const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(started.body)?.[1];
    if (authSessionId === undefined) throw new Error('no auth_session_id in the rendered form');

    const form = new URLSearchParams({
      auth_session_id: authSessionId,
      username: ALICE_USERNAME,
      password: ALICE_PASSWORD,
    });
    const signedIn = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/login-actions/authenticate`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(signedIn.statusCode).toBe(302);
    const location = new URL(locationHeader(signedIn));
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('code')).toBeNull();
  });

  // The same defect on the chooser: `prompt=select_account` together with
  // a claims `sub` forces the chooser to a single candidate (decideReuse's
  // own `select_account` rule) rather than reusing it directly, and a
  // session_id posted back is a claim the chooser page never offered —
  // Bob's live session was never rendered as a choice.
  it('refuses when the chooser is asked to complete as a session the sub rule excluded', async () => {
    const alice = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {});
    const both = await signInAdditional(alice.cookie, BOB_USERNAME, BOB_PASSWORD);
    const jar = both.cookie;

    // Names Alice, so the candidate filter already excludes Bob's session
    // before decideReuse ever runs — `select_account` still forces the
    // chooser rather than reusing the one filtered candidate directly.
    const select = await authorize(
      {
        claims: subClaim(aliceSubjectId),
        prompt: 'select_account',
        code_challenge: CHALLENGE,
      },
      { cookie: jar },
    );
    expect(select.statusCode).toBe(200);
    const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(select.body)?.[1];
    const aliceSessionId = /name="session_id" value="([^"]*)"/.exec(select.body)?.[1];
    if (authSessionId === undefined || aliceSessionId === undefined) {
      throw new Error('no auth_session_id/session_id on the chooser page');
    }
    // Only Alice was ever offered — Bob's session never appears as a choice.
    expect(select.body).not.toContain(BOB_USERNAME);

    // Every live session id on this browser, from the *unnarrowed* chooser
    // (no claims `sub`, so both accounts render) — what an attacker who
    // already knows a session id would post back instead of what the
    // narrowed page above actually offered.
    const bothAccounts = await authorize(
      { prompt: 'select_account', code_challenge: CHALLENGE },
      { cookie: jar },
    );
    const bobSessionId = [...bothAccounts.body.matchAll(/name="session_id" value="([^"]*)"/g)]
      .map((match) => match[1])
      .find((id): id is string => id !== undefined && id !== aliceSessionId);
    if (bobSessionId === undefined) throw new Error('expected Bob’s own live session id');

    const form = new URLSearchParams({ auth_session_id: authSessionId, session_id: bobSessionId });
    const chosen = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/login-actions/select-account`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    });
    expect(chosen.statusCode).toBe(302);
    const location = new URL(locationHeader(chosen));
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('code')).toBeNull();
  });
});

// The parameter is not a path around consent: the only reason `email` is
// absent from the second case is the ungranted scope, proven by the first
// case returning it for the identical request, subject and mapper with
// nothing else changed but `scope`.
describe('[ODUDU-CLAIMS-USERINFO-01] a requested userinfo claim is intersected with the granted scope', () => {
  it('returns a requested claim from UserInfo when its scope was granted', async () => {
    const body = await userinfoAfter({
      claims: JSON.stringify({ userinfo: { email: null } }),
      scope: 'openid email',
    });
    expect(body.email).toBe(ALICE_EMAIL);
  });

  it('does not return a requested claim whose scope was not granted', async () => {
    const body = await userinfoAfter({
      claims: JSON.stringify({ userinfo: { email: null } }),
      scope: 'openid',
    });
    expect('email' in body).toBe(false);
  });

  // Narrows, not merely fails to widen: a `profile`-scope claim nobody named
  // in `claims` is dropped even though `scope` would otherwise have granted
  // it, once the request has named anything at all for this member.
  it('drops a scope-granted claim nobody named once the parameter narrows the response', async () => {
    const body = await userinfoAfter({
      claims: JSON.stringify({ userinfo: { email: null } }),
      scope: 'openid profile email',
    });
    expect(body.email).toBe(ALICE_EMAIL);
    expect('preferred_username' in body).toBe(false);
  });
});

// `resource` shipped carried by only one door in four, caught only by
// [ODUDU-RESOURCE-05] in resource-authorize.int.test.ts. `claims` reaches
// the code through the same call sites; this drives each one, including
// the required-action detour, which resumes the same parked session
// `formLogin` started and so inherits `claims` "for free" — tested anyway,
// since "correct by construction" is exactly what that gap disproved.
describe('the claims request reaches the code through every door that mints one', () => {
  it('is carried through immediate session reuse', async () => {
    const { cookie } = await formLogin(ALICE_USERNAME, ALICE_PASSWORD, {});
    const response = await authorize(
      {
        claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
        code_challenge: CHALLENGE,
      },
      { cookie },
    );
    expect(response.statusCode).toBe(302);
    const code = new URL(locationHeader(response)).searchParams.get('code');
    if (code === null) throw new Error('expected a code on the reuse redirect');
    const redeemed = await redeemCode(code);
    expect(redeemed.statusCode).toBe(200);
    const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(jwtPayload(idToken).auth_time).toEqual(expect.any(Number));
  });

  it('is carried through the account chooser', async () => {
    const code = await chooseAccountSelf(CAROL_USERNAME, CAROL_PASSWORD, {
      claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
    });
    const redeemed = await redeemCode(code);
    expect(redeemed.statusCode).toBe(200);
    const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(jwtPayload(idToken).auth_time).toEqual(expect.any(Number));
  });

  it('is carried through the consent POST after a fresh login', async () => {
    const code = await completeThroughConsent(DAVE_USERNAME, DAVE_PASSWORD, false, {
      claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
    });
    const redeemed = await redeemCode(code);
    expect(redeemed.statusCode).toBe(200);
    const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(jwtPayload(idToken).auth_time).toEqual(expect.any(Number));
  });

  it('is carried through the consent POST after a live-session reuse is promoted', async () => {
    const code = await completeThroughConsent(ERIN_USERNAME, ERIN_PASSWORD, true, {
      claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
    });
    const redeemed = await redeemCode(code);
    expect(redeemed.statusCode).toBe(200);
    const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(jwtPayload(idToken).auth_time).toEqual(expect.any(Number));
  });

  it('is carried through the required-action detour', async () => {
    await withTenant(app.db, TENANT_ID, (tx) =>
      requiredActionRepository(tx).add(TENANT_ID, frankSubjectId, 'update-password'),
    );
    const newPassword = 'a considerably better passphrase than before';
    const code = await completeThroughRequiredAction(FRANK_USERNAME, FRANK_PASSWORD, newPassword, {
      claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
    });
    const redeemed = await redeemCode(code);
    expect(redeemed.statusCode).toBe(200);
    const { id_token: idToken } = redeemed.json<{ id_token?: string }>();
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(jwtPayload(idToken).auth_time).toEqual(expect.any(Number));
  });
});

describe('an unparsable claims parameter is refused', () => {
  it('refuses an unparsable claims parameter with invalid_request', async () => {
    const response = await authorize({ claims: '{' });
    expect(response.statusCode).toBe(302);
    expect(new URL(locationHeader(response)).searchParams.get('error')).toBe('invalid_request');
  });
});
