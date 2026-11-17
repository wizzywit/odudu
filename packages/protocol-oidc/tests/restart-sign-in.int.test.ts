import { authenticationSessions, provisionTenant } from '@odudu/authn-flows';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { clientOidcConfig } from '#/schema/client-oidc-config';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { noBreachedLookup } from '#/testing/breached-check';

const CLIENT_ID = 'restart-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 7);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const EXPIRED_NOTICE = 'This sign-in attempt is no longer valid. Go back and start again.';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let clock: FakeClock;

async function setupTenant(name: string): Promise<string> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Restart client',
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
  });
  return tenantId;
}

function authorizeUrl(tenant: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz 123',
    nonce: 'n-1',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`;
}

function authSessionIdOf(res: LightMyRequestResponse): string {
  const id = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

function submit(tenant: string, fields: Record<string, string>): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant}/login-actions/authenticate`,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// The same request, whatever order its parameters came in.
function asRequest(location: string | undefined): { path: string; params: Record<string, string> } {
  const url = new URL(location ?? 'x:', 'https://server.example');
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) };
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function linkLabelled(res: LightMyRequestResponse, label: string): string | undefined {
  const raw = new RegExp(`<a href="([^"]*)">${label}</a>`, 'u').exec(res.body)?.[1];
  return raw === undefined ? undefined : unescapeHtml(raw);
}

const restartHref = (res: LightMyRequestResponse) => linkLabelled(res, 'Start sign-in again');
const returnHref = (res: LightMyRequestResponse) => linkLabelled(res, 'Return to the application');

// The cookies a login set, as the browser would send them back.
function cookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values
    .map((value) => value.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

async function signedInCookie(name: string): Promise<string> {
  const form = await http.inject({ url: authorizeUrl(name) });
  const res = await submit(name, {
    auth_session_id: authSessionIdOf(form),
    username: USERNAME,
    password: PASSWORD,
  });
  expect(res.statusCode).toBe(302);
  return cookieOf(res);
}

function expireRow(id: string): Promise<unknown> {
  return owner.db
    .update(authenticationSessions)
    .set({ expiresAt: new Date(clock.now().getTime() - 1000) })
    .where(eq(authenticationSessions.id, id));
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  clock = new FakeClock(new Date());
  http = Fastify();
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
      clock,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

describe('a login form restored by the browser after Back', () => {
  it('is never cached, and reloads itself when the page cache restores it', async () => {
    const name = `acme-restore-${newId()}`;
    await setupTenant(name);
    const res = await http.inject({ url: authorizeUrl(name) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const nonce = /<script nonce="([^"]+)">[^<]*pageshow[^<]*<\/script>/.exec(res.body)?.[1];
    expect(nonce).toBeDefined();
    expect(String(res.headers['content-security-policy'])).toContain(
      `script-src 'nonce-${nonce ?? ''}'`,
    );
  });

  it('is not given the script when the page answers a POST, which a reload would resend', async () => {
    const name = `acme-post-${newId()}`;
    await setupTenant(name);
    const form = await http.inject({ url: authorizeUrl(name) });
    const rejected = await submit(name, {
      auth_session_id: authSessionIdOf(form),
      username: USERNAME,
      password: 'wrong',
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.body).toContain('auth_session_id');
    expect(rejected.body).not.toContain('<script');
    expect(rejected.headers['cache-control']).toBe('no-store');
  });

  it('is not given the script when the authorization request itself was a POST', async () => {
    const name = `acme-postauth-${newId()}`;
    await setupTenant(name);
    const [path, query] = authorizeUrl(name).split('?');
    const res = await http.inject({
      method: 'POST',
      url: path ?? '',
      payload: query ?? '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('auth_session_id');
    expect(res.body).not.toContain('<script');
  });
});

describe('a sign-in that expired while its form was open', () => {
  it('offers to start again, and the link yields a form that signs in', async () => {
    const name = `acme-expired-${newId()}`;
    await setupTenant(name);
    const form = await http.inject({ url: authorizeUrl(name) });
    const stale = authSessionIdOf(form);
    clock.advance(31 * 60_000);

    const refused = await submit(name, {
      auth_session_id: stale,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain(EXPIRED_NOTICE);
    expect(refused.body).not.toContain('<script');
    expect(refused.headers.location).toBeUndefined();

    const href = restartHref(refused);
    expect(asRequest(href)).toEqual(asRequest(authorizeUrl(name)));

    const fresh = await http.inject({ url: href ?? '' });
    expect(fresh.statusCode).toBe(200);
    const next = authSessionIdOf(fresh);
    expect(next).not.toBe(stale);
    const signedIn = await submit(name, {
      auth_session_id: next,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(signedIn.statusCode).toBe(302);
    const location = new URL(String(signedIn.headers.location));
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('xyz 123');
    expect(location.searchParams.get('code')).toBeTruthy();
  });

  it('offers the link on a consent, required-action or chooser submission too', async () => {
    const name = `acme-other-doors-${newId()}`;
    await setupTenant(name);
    const stale = authSessionIdOf(await http.inject({ url: authorizeUrl(name) }));
    clock.advance(31 * 60_000);
    for (const path of ['consent', 'select-account']) {
      const res = await http.inject({
        method: 'POST',
        url: `/tenants/${name}/login-actions/${path}`,
        payload: new URLSearchParams({ auth_session_id: stale, decision: 'allow' }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(res.statusCode).toBe(400);
      expect(asRequest(restartHref(res))).toEqual(asRequest(authorizeUrl(name)));
    }
    const action = await http.inject({
      method: 'POST',
      url: `/tenants/${name}/login-actions/required-action?action=update-password`,
      payload: new URLSearchParams({ auth_session_id: stale }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(action.statusCode).toBe(400);
    expect(asRequest(restartHref(action))).toEqual(asRequest(authorizeUrl(name)));
  });

  it('keeps the generic text once the reaper has deleted the row', async () => {
    const name = `acme-reaped-${newId()}`;
    await setupTenant(name);
    const stale = authSessionIdOf(await http.inject({ url: authorizeUrl(name) }));
    clock.advance(31 * 60_000);
    await owner.db.delete(authenticationSessions).where(eq(authenticationSessions.id, stale));

    const refused = await submit(name, {
      auth_session_id: stale,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain(EXPIRED_NOTICE);
    expect(refused.body).not.toContain('<a ');
  });

  it('offers nothing for an id that names no session, or a malformed one', async () => {
    const name = `acme-unknown-${newId()}`;
    await setupTenant(name);
    for (const id of [newId(), 'not-a-uuid', '']) {
      const refused = await submit(name, {
        auth_session_id: id,
        username: USERNAME,
        password: PASSWORD,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toContain(EXPIRED_NOTICE);
      expect(refused.body).not.toContain('<a ');
    }
  });

  it("offers nothing for another tenant's session id", async () => {
    const mine = `acme-mine-${newId()}`;
    const theirs = `acme-theirs-${newId()}`;
    await setupTenant(mine);
    await setupTenant(theirs);
    const foreign = authSessionIdOf(await http.inject({ url: authorizeUrl(theirs) }));
    clock.advance(31 * 60_000);
    const refused = await submit(mine, {
      auth_session_id: foreign,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).not.toContain('<a ');
  });
});

// A request that demanded a fresh authentication must demand it again: the
// restart link may never answer from an SSO session the original refused.
describe('a restarted request keeps what it demanded', () => {
  async function restartedWith(
    extra: Record<string, string>,
    ageMinutes: number,
  ): Promise<{ href: string; followed: LightMyRequestResponse; first: LightMyRequestResponse }> {
    const name = `acme-demand-${newId()}`;
    await setupTenant(name);
    const cookie = await signedInCookie(name);
    clock.advance(ageMinutes * 60_000);
    const first = await http.inject({ url: authorizeUrl(name, extra), headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const id = authSessionIdOf(first);
    await expireRow(id);
    const refused = await submit(name, {
      auth_session_id: id,
      username: USERNAME,
      password: PASSWORD,
    });
    const href = restartHref(refused);
    expect(href).toBeDefined();
    const followed = await http.inject({ url: href ?? '', headers: { cookie } });
    return { href: href ?? '', followed, first };
  }

  it('asks for a fresh sign-in again when max_age had made the session too old', async () => {
    const { href, followed } = await restartedWith({ max_age: '60' }, 10);
    expect(new URL(href, 'https://x').searchParams.get('max_age')).toBe('60');
    expect(followed.statusCode).toBe(200);
    expect(followed.headers.location).toBeUndefined();
    expect(followed.body).toContain('name="auth_session_id"');
  });

  it('asks for a fresh sign-in again under prompt=login', async () => {
    const { href, followed } = await restartedWith({ prompt: 'login' }, 0);
    expect(new URL(href, 'https://x').searchParams.get('prompt')).toBe('login');
    expect(followed.statusCode).toBe(200);
    expect(followed.body).toContain('name="auth_session_id"');
  });
});

// A request tied to one subject by a hint or a claims `sub` cannot be
// rebuilt, so the page hands the person back to the application, which
// restarts with a hint of its own.
describe('a request that cannot be rebuilt returns to the application', () => {
  const SUBJECT = '01a13787-6969-7c23-ab7f-382a9a9af6d4';
  const claimsSub = JSON.stringify({ id_token: { sub: { value: SUBJECT } } });

  async function expiredRefusal(
    name: string,
    extra: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    const form = await http.inject({ url: authorizeUrl(name, extra) });
    expect(form.statusCode).toBe(200);
    const id = authSessionIdOf(form);
    await expireRow(id);
    return submit(name, { auth_session_id: id, username: USERNAME, password: PASSWORD });
  }

  it('offers the redirect_uri with access_denied, state and iss, and no restart link', async () => {
    const name = `acme-claims-sub-${newId()}`;
    await setupTenant(name);
    const refused = await expiredRefusal(name, { claims: claimsSub });
    expect(refused.statusCode).toBe(400);
    expect(restartHref(refused)).toBeUndefined();
    const back = new URL(returnHref(refused) ?? 'x:');
    expect(back.origin + back.pathname).toBe(REDIRECT_URI);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('xyz 123');
    expect(back.searchParams.get('iss')).toContain(`/tenants/${name}`);
    expect(back.searchParams.has('code')).toBe(false);
  });

  it('is never offered once the client no longer registers that redirect_uri', async () => {
    const name = `acme-gone-uri-${newId()}`;
    const tenantId = await setupTenant(name);
    const form = await http.inject({ url: authorizeUrl(name, { claims: claimsSub }) });
    const id = authSessionIdOf(form);
    await expireRow(id);
    await owner.db
      .update(clientOidcConfig)
      .set({ redirectUris: ['https://elsewhere.example/cb'] })
      .where(eq(clientOidcConfig.tenantId, tenantId));
    const refused = await submit(name, {
      auth_session_id: id,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).not.toContain('<a ');
  });

  it('is never offered for a client that has been disabled', async () => {
    const name = `acme-off-client-${newId()}`;
    const tenantId = await setupTenant(name);
    const form = await http.inject({ url: authorizeUrl(name, { claims: claimsSub }) });
    const id = authSessionIdOf(form);
    await expireRow(id);
    await owner.db.update(clients).set({ enabled: false }).where(eq(clients.tenantId, tenantId));
    const refused = await submit(name, {
      auth_session_id: id,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.body).not.toContain('<a ');
  });

  it('offers nothing when the request was never parked with a validated redirect_uri', async () => {
    const name = `acme-hint-row-${newId()}`;
    const tenantId = await setupTenant(name);
    const id = newId();
    await owner.db.insert(authenticationSessions).values({
      id,
      tenantId,
      pendingRequest: {
        clientId: CLIENT_ID,
        redirectUri: 'https://not-registered.example/cb',
        scope: 'openid',
        state: 's',
        nonce: null,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        idTokenHintSubject: SUBJECT,
      },
      expiresAt: new Date(clock.now().getTime() - 60_000),
    });
    const refused = await submit(name, {
      auth_session_id: id,
      username: USERNAME,
      password: PASSWORD,
    });
    expect(refused.body).toContain(EXPIRED_NOTICE);
    expect(refused.body).not.toContain('<a ');
  });

  it('carries a hostile state through both links without breaking the markup', async () => {
    const hostile = `"><script>alert(1)</script>'&amp;%22\\//evil.example\u202e ${'é'.repeat(50)}`;
    const plain = `acme-hostile-${newId()}`;
    await setupTenant(plain);
    const refusedPlain = await expiredRefusal(plain, { state: hostile });
    expect(refusedPlain.body).not.toContain('<script>alert');
    expect(refusedPlain.body.match(/<a /gu)).toHaveLength(1);
    expect(new URL(restartHref(refusedPlain) ?? 'x:', 'https://x').searchParams.get('state')).toBe(
      hostile,
    );

    const tied = `acme-hostile-tied-${newId()}`;
    await setupTenant(tied);
    const refusedTied = await expiredRefusal(tied, { state: hostile, claims: claimsSub });
    expect(refusedTied.body).not.toContain('<script>alert');
    expect(refusedTied.body.match(/<a /gu)).toHaveLength(1);
    const back = new URL(returnHref(refusedTied) ?? 'x:');
    expect(back.origin + back.pathname).toBe(REDIRECT_URI);
    expect(back.searchParams.get('state')).toBe(hostile);
  });

  it('does not offer a response_mode other than query a way to bypass the redirect check', async () => {
    const name = `acme-mode-${newId()}`;
    await setupTenant(name);
    const res = await http.inject({ url: authorizeUrl(name, { response_mode: 'fragment' }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('<a ');
  });
});

describe('a followed restart link is still held to the client as registered now', () => {
  async function refusalWithLink(name: string): Promise<string> {
    const form = await http.inject({ url: authorizeUrl(name) });
    const id = authSessionIdOf(form);
    await expireRow(id);
    const refused = await submit(name, {
      auth_session_id: id,
      username: USERNAME,
      password: PASSWORD,
    });
    return restartHref(refused) ?? '';
  }

  it('is refused for a client disabled since', async () => {
    const name = `acme-follow-off-${newId()}`;
    const tenantId = await setupTenant(name);
    const href = await refusalWithLink(name);
    await owner.db.update(clients).set({ enabled: false }).where(eq(clients.tenantId, tenantId));
    const followed = await http.inject({ url: href });
    expect(followed.statusCode).toBe(400);
    expect(followed.body).toContain('invalid_client');
  });

  it('is refused for a redirect_uri unregistered since', async () => {
    const name = `acme-follow-uri-${newId()}`;
    const tenantId = await setupTenant(name);
    const href = await refusalWithLink(name);
    await owner.db
      .update(clientOidcConfig)
      .set({ redirectUris: ['https://elsewhere.example/cb'] })
      .where(eq(clientOidcConfig.tenantId, tenantId));
    const followed = await http.inject({ url: href });
    expect(followed.statusCode).toBe(400);
    expect(followed.headers.location).toBeUndefined();
  });
});

describe('the other doors a stale id reaches', () => {
  it.each(['update-password', 'configure-totp', 'generate-recovery-codes', 'configure-passkey'])(
    'offers the link on the required-action POST for %s',
    async (action) => {
      const name = `acme-door-${newId()}`;
      await setupTenant(name);
      const stale = authSessionIdOf(await http.inject({ url: authorizeUrl(name) }));
      await expireRow(stale);
      const res = await http.inject({
        method: 'POST',
        url: `/tenants/${name}/login-actions/required-action?action=${action}`,
        payload: new URLSearchParams({ auth_session_id: stale }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(res.statusCode).toBe(400);
      expect(asRequest(restartHref(res))).toEqual(asRequest(authorizeUrl(name)));
    },
  );
});
