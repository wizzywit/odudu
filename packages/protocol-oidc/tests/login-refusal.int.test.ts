import { provisionTenant } from '@odudu/authn-flows';
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

const CLIENT_ID = 'refusal-client';
const REDIRECT_URI = 'https://app.example/callback';
// Equal lengths, so the four refusals can be compared byte for byte.
const RIGHT_USERNAME = 'right-us';
const LOCKED_USERNAME = 'locked-u';
const DISABLED_USERNAME = 'disabled';
const UNKNOWN_USERNAME = 'nobody!!';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 7);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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
      name: 'Refusal client',
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
    for (const username of [RIGHT_USERNAME, LOCKED_USERNAME, DISABLED_USERNAME]) {
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: await hashPassword(PASSWORD) },
      });
      if (username === DISABLED_USERNAME) await subjectRepository(tx).setEnabled(subject.id, false);
    }
  });
  return tenantId;
}

function authorizeUrl(tenant: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    nonce: 'n-1',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`;
}

async function startSession(tenant: string, extra: Record<string, string> = {}): Promise<string> {
  const form = await http.inject({ url: authorizeUrl(tenant, extra) });
  const id = /name="auth_session_id" value="([^"]*)"/.exec(form.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

async function signIn(
  tenant: string,
  username: string,
  password: string,
  session?: string,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: session ?? (await startSession(tenant)),
      username,
      password,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// What may differ between two refusals: the per-attempt session id, the
// nonce (there is none on this page) and the name that was typed, which is
// what the form gives back.
function normalised(res: LightMyRequestResponse, typed: string): string {
  const headers = Object.fromEntries(
    Object.entries(res.headers).filter(([name]) => name !== 'date'),
  );
  return JSON.stringify({
    status: res.statusCode,
    headers,
    body: res.body
      .replace(/name="auth_session_id" value="[^"]*"/u, 'name="auth_session_id" value="SESSION"')
      .replace(/nonce="[^"]*"/gu, 'nonce="NONCE"')
      .replaceAll(`value="${typed}"`, 'value="TYPED"'),
  });
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

describe('a refused password step', () => {
  it('says so, gives back the username and not the password', async () => {
    const name = `refusal-say-${newId()}`;
    await setupTenant(name);

    const res = await signIn(name, RIGHT_USERNAME, 'a placeholder password');

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(
      '<li id="form-error-0">Sign-in failed. Check your details and try again.</li>',
    );
    expect(res.body).toContain(`name="username" autocomplete="username" value="${RIGHT_USERNAME}"`);
    expect(res.body).not.toContain('a placeholder password');
    expect(res.body).toMatch(/name="password"[^>]*autofocus/u);
  });

  it('names the client and the tenant on the form and again on the refusal', async () => {
    const name = `refusal-names-${newId()}`;
    await setupTenant(name);
    const first = await http.inject({ url: authorizeUrl(name) });
    const second = await signIn(name, RIGHT_USERNAME, 'a placeholder password');

    for (const res of [first, second]) {
      expect(res.body).toContain('<p class="context">to continue to <bdi>Refusal client</bdi></p>');
      expect(res.body).toContain(`<p class="tenant"><bdi>${name}</bdi></p>`);
    }
  });

  it('is the same page for a wrong password, an unknown name, a locked and a disabled account', async () => {
    const name = `refusal-same-${newId()}`;
    await setupTenant(name);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(name, LOCKED_USERNAME, 'not the password');
    }

    const answers = [
      { typed: RIGHT_USERNAME, res: await signIn(name, RIGHT_USERNAME, 'not the password') },
      { typed: UNKNOWN_USERNAME, res: await signIn(name, UNKNOWN_USERNAME, PASSWORD) },
      // The right password, so only the lock keeps this out.
      { typed: LOCKED_USERNAME, res: await signIn(name, LOCKED_USERNAME, PASSWORD) },
      { typed: DISABLED_USERNAME, res: await signIn(name, DISABLED_USERNAME, PASSWORD) },
    ];

    for (const { typed, res } of answers) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Sign-in failed.');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body).toContain(`value="${typed}"`);
    }
    const [first, ...rest] = answers;
    for (const other of rest) {
      expect(normalised(other.res, other.typed)).toBe(
        normalised(first?.res ?? other.res, RIGHT_USERNAME),
      );
    }
  });

  it('keeps the person at the password step, and lets the next attempt through', async () => {
    const name = `refusal-retry-${newId()}`;
    await setupTenant(name);
    const session = await startSession(name);

    const refused = await signIn(name, RIGHT_USERNAME, 'not the password', session);
    expect(refused.body).toContain(`name="auth_session_id" value="${session}"`);

    const next = await signIn(name, RIGHT_USERNAME, PASSWORD, session);
    expect(next.statusCode).toBe(302);
    expect(String(next.headers.location)).toContain('code=');
  });

  it('claims no failure for a form submitted with nothing in it', async () => {
    const name = `refusal-empty-${newId()}`;
    await setupTenant(name);
    const res = await http.inject({
      method: 'POST',
      url: `/tenants/${name}/login-actions/authenticate`,
      payload: new URLSearchParams({ auth_session_id: await startSession(name) }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('role="alert"');
  });

  it.each([
    ['a quote and a tag', '"><script>alert(1)</script>'],
    ['an apostrophe and an ampersand', "o'brien&amp;co"],
    ['unicode and a bidi override', 'Zoë 名前 ‮evil'],
  ])('reflects %s inert', async (_label, typed) => {
    const name = `refusal-xss-${newId()}`;
    await setupTenant(name);

    const res = await signIn(name, typed, 'a placeholder password');

    expect(res.body).not.toContain('<script>alert');
    const echoed = /name="username"[^>]* value="([^"]*)"/u.exec(res.body)?.[1] ?? '';
    expect(
      echoed
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    ).toBe(typed);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('does not reflect a username a megabyte long', async () => {
    const name = `refusal-long-${newId()}`;
    await setupTenant(name);

    const res = await signIn(name, 'a'.repeat(900_000), 'a placeholder password');

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeLessThan(5_000);
    expect(res.body).toContain('Sign-in failed.');
  });
});

async function setEnabled(tenantName: string, username: string, enabled: boolean): Promise<void> {
  const [tenant] = await owner.db.select().from(tenants).where(eq(tenants.name, tenantName));
  if (tenant === undefined) throw new Error('no such tenant');
  await withTenant(app.db, tenant.id, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.username, username));
    if (user === undefined) throw new Error('no such user');
    await subjectRepository(tx).setEnabled(user.subjectId, enabled);
  });
}

function consentPost(tenant: string, session: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant}/login-actions/consent`,
    payload: new URLSearchParams({ auth_session_id: session, decision: 'allow' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('a disabled account where a later gate would have spoken', () => {
  it('is refused like a wrong password under prompt=consent, not shown the consent page', async () => {
    const name = `refusal-consent-${newId()}`;
    await setupTenant(name);
    const asked = { prompt: 'consent' };
    const wrong = await signIn(
      name,
      RIGHT_USERNAME,
      'not the password',
      await startSession(name, asked),
    );
    const disabled = await signIn(
      name,
      DISABLED_USERNAME,
      PASSWORD,
      await startSession(name, asked),
    );

    expect(disabled.body).not.toContain('login-actions/consent');
    expect(disabled.statusCode).toBe(200);
    expect(normalised(disabled, DISABLED_USERNAME)).toBe(normalised(wrong, RIGHT_USERNAME));
  });

  it('is refused like a wrong password when the address is unverified', async () => {
    const name = `refusal-unverified-${newId()}`;
    const tenantId = await setupTenant(name);
    await withTenant(app.db, tenantId, (tx) =>
      tx.update(tenants).set({ verifyEmail: true }).where(eq(tenants.id, tenantId)),
    );
    const wrong = await signIn(name, RIGHT_USERNAME, 'not the password');
    const disabled = await signIn(name, DISABLED_USERNAME, PASSWORD);

    expect(disabled.body).not.toContain('Verify your email');
    expect(normalised(disabled, DISABLED_USERNAME)).toBe(normalised(wrong, RIGHT_USERNAME));
  });

  it('clears the attempt, so the next person on the same session can sign in', async () => {
    const name = `refusal-progress-${newId()}`;
    await setupTenant(name);
    const session = await startSession(name);

    const refused = await signIn(name, DISABLED_USERNAME, PASSWORD, session);
    expect(refused.statusCode).toBe(200);
    const next = await signIn(name, RIGHT_USERNAME, PASSWORD, session);

    expect(next.statusCode).toBe(302);
  });

  it('refuses a consent decision from an account disabled after the consent page, as expired', async () => {
    const name = `refusal-consent-post-${newId()}`;
    await setupTenant(name);
    const session = await startSession(name, { prompt: 'consent' });
    const asked = await signIn(name, RIGHT_USERNAME, PASSWORD, session);
    expect(asked.body).toContain('login-actions/consent');
    await setEnabled(name, RIGHT_USERNAME, false);

    const res = await consentPost(name, session);

    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
