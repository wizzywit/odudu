import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  type DatabaseHandle,
} from '@odudu/db';
import { authenticationSessions } from '@odudu/authn-flows';
import { actionTokens } from '@odudu/account';
import { users } from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, desc, eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// A link mailed out of a sign-in (verification, password reset) brings the
// person back to that sign-in, with the application's own state, nonce and
// challenge, and only the browser that parked it. Through the real
// composition root, on a real database.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const STATE = 'SECRET-STATE';
const NONCE = 'SECRET-NONCE';
const NO_LINK = 'Return to the application you were signing in to and sign in again.';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = 'https://idp.example.test';
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  http = buildApp({
    tls: false,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    publicBaseUrl: 'https://idp.example.test',
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface Tenant {
  name: string;
  id: string;
  email: string;
  username: string;
}

async function tenant(): Promise<Tenant> {
  const name = `resume-${newId()}`;
  const username = `u${newId().slice(-8)}`;
  const email = `${username}@example.test`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT_URI],
    username,
    password: PASSWORD,
    email,
  });
  await owner.db
    .update(tenants)
    .set({ registrationAllowed: true, resetPasswordAllowed: true, verifyEmail: true })
    .where(eq(tenants.id, seeded.tenantId));
  // A reset link goes only to a verified address on a tenant that asks for proof.
  await owner.db.update(users).set({ emailVerified: true }).where(eq(users.email, email));
  return { name, id: seeded.tenantId, email, username };
}

function authorizeUrl(name: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: STATE,
    nonce: NONCE,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}`;
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function hrefLabelled(res: LightMyRequestResponse, label: string): string | undefined {
  const escaped = label.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const raw = new RegExp(`<a href="([^"]*)">${escaped}</a>`, 'u').exec(res.body)?.[1];
  return raw === undefined ? undefined : unescapeHtml(raw);
}

function authSessionIdOf(res: LightMyRequestResponse): string {
  const id = /name="auth_session_id" value="([^"]*)"/u.exec(res.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

function cookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const pair = values
    .map((value) => value.split(';')[0] ?? '')
    .find((p) => p.startsWith('odudu-sign-in='));
  if (pair === undefined) throw new Error('the login page set no sign-in cookie');
  return pair;
}

function request(
  method: 'GET' | 'POST',
  url: string,
  fields?: Record<string, string>,
  cookie?: string,
): Promise<LightMyRequestResponse> {
  return http.inject({
    method,
    url,
    ...(fields === undefined ? {} : { payload: new URLSearchParams(fields).toString() }),
    headers: {
      ...(fields === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
      ...(cookie === undefined ? {} : { cookie }),
    },
  });
}

async function mailedLink(to: string): Promise<string> {
  const rows = await owner.db
    .select({ text: emailOutbox.bodyText })
    .from(emailOutbox)
    .where(eq(emailOutbox.toAddress, to))
    .orderBy(desc(emailOutbox.createdAt));
  const link = /https:\/\/idp\.example\.test(\S+)/u.exec(rows[0]?.text ?? '')?.[1];
  if (link === undefined) throw new Error(`no link mailed to ${to}`);
  expect([...new URL(link, 'https://x').searchParams.keys()]).toEqual(['key']);
  return link;
}

interface Parked {
  cookie: string;
  login: LightMyRequestResponse;
  authSessionId: string;
  carried: string;
}

// A browser that opened the application's sign-in and followed the link that
// leads to `page`.
async function parkAndOpen(
  t: Tenant,
  page: 'Forgot password?' | 'Create an account',
): Promise<Parked> {
  const login = await request('GET', authorizeUrl(t.name));
  const cookie = cookieOf(login);
  const form = await request('GET', hrefLabelled(login, page) ?? '', undefined, cookie);
  const carried = hrefLabelled(form, 'Back to sign in') ?? '';
  return { cookie, login, authSessionId: authSessionIdOf(login), carried };
}

async function askForReset(t: Tenant, parked: Parked, cookie: string | undefined): Promise<string> {
  const sent = await request(
    'POST',
    `/tenants/${t.name}/login-actions/reset-password`,
    { email: t.email, return_to: parked.carried },
    cookie,
  );
  expect(sent.statusCode).toBe(200);
  return mailedLink(t.email);
}

// Opening a registration or verification link asks; this is the button on its page.
async function pressButton(link: string, cookie: string | undefined) {
  const page = await request('GET', link, undefined, cookie);
  expect(page.statusCode).toBe(200);
  const key = /name="key" value="([^"]*)"/u.exec(page.body)?.[1] ?? '';
  const tenant = /\/tenants\/([^/]+)\//u.exec(link)?.[1] ?? '';
  return request('POST', `/tenants/${tenant}/login-actions/action-token`, { key }, cookie);
}

async function resetPassword(t: Tenant, link: string, cookie: string | undefined) {
  const form = await request('GET', link, undefined, cookie);
  expect(form.statusCode).toBe(200);
  expect(form.body).not.toContain('return_to');
  const key = /name="key" value="([^"]*)"/u.exec(form.body)?.[1] ?? '';
  return request(
    'POST',
    `/tenants/${t.name}/login-actions/action-token`,
    { key, password: `new ${newId()} passphrase` },
    cookie,
  );
}

async function parkedRequestOf(sessionId: string) {
  const [row] = await owner.db
    .select({ pending: authenticationSessions.pendingRequest })
    .from(authenticationSessions)
    .where(eq(authenticationSessions.id, sessionId));
  return row?.pending;
}

describe('forgot password from a sign-in, in the browser that started it', () => {
  it('continues the original request, with its state and nonce, and the sign-in completes', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Forgot password?');
    const link = await askForReset(t, parked, parked.cookie);

    const done = await resetPassword(t, link, parked.cookie);
    expect(done.statusCode).toBe(200);
    expect(done.headers['set-cookie']).toBeUndefined();
    const onward = hrefLabelled(done, 'Continue to sign in') ?? '';
    expect(onward).toBe(parked.carried);
    const query = new URL(onward, 'https://x').searchParams;
    expect(query.get('state')).toBe(STATE);
    expect(query.get('nonce')).toBe(NONCE);
    expect(query.get('code_challenge')).toBe(CHALLENGE);

    // Followed, it is the original request again: a new parked request that
    // holds the application's own state, nonce and challenge, which then
    // signs in and is answered to the application's redirect with that state.
    const resumed = await request('GET', onward, undefined, parked.cookie);
    expect(resumed.statusCode).toBe(200);
    const pending = await parkedRequestOf(authSessionIdOf(resumed));
    expect(pending).toMatchObject({
      clientId: 'portal',
      redirectUri: REDIRECT_URI,
      state: STATE,
      nonce: NONCE,
      codeChallenge: CHALLENGE,
    });
    const signedIn = await request('POST', `/tenants/${t.name}/login-actions/authenticate`, {
      auth_session_id: authSessionIdOf(resumed),
      username: t.username,
      password: PASSWORD,
    });
    expect([200, 302]).toContain(signedIn.statusCode);
  });

  it('does the same for a verification link mailed from registration', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Create an account');
    const username = `v${newId().slice(-8)}`;
    const email = `${username}@example.test`;
    const registered = await request(
      'POST',
      `/tenants/${t.name}/login-actions/registration`,
      {
        username,
        email,
        password: PASSWORD,
        password_confirm: PASSWORD,
        return_to: parked.carried,
      },
      parked.cookie,
    );
    expect(registered.statusCode).toBe(201);
    const link = await mailedLink(email);

    const verified = await pressButton(link, parked.cookie);
    expect(verified.statusCode).toBe(200);
    expect(hrefLabelled(verified, 'Continue to sign in')).toBe(parked.carried);
    expect(verified.body).not.toContain(NO_LINK);

    // A registration link is gone once opened, and a spent one names no
    // sign-in: it reads like any link nothing holds.
    const spentHere = await request('GET', link, undefined, parked.cookie);
    expect(spentHere.statusCode).toBe(400);
    expect(spentHere.body).not.toContain('Back to sign in');
  });
});

// Initiating User Registration via OpenID Connect 1.0: the application asks
// for the registration page outright, and the person comes back to it with
// the application's own state and nonce once their account exists.
describe('prompt=create, in the browser that asked for it', () => {
  it('lands on the registration page, and the way back signs the new account in to the original request', async () => {
    const t = await tenant();
    const asked = await request('GET', `${authorizeUrl(t.name)}&prompt=create`);
    expect(asked.statusCode).toBe(303);
    const cookie = cookieOf(asked);
    const location = String(asked.headers.location);
    expect(location.startsWith(`/tenants/${t.name}/login-actions/registration?return_to=`)).toBe(
      true,
    );

    // The same page the sign-in form's link leads to, carrying the same
    // kind of way back: this request, now asking for a sign-in.
    const form = await request('GET', location, undefined, cookie);
    expect(form.statusCode).toBe(200);
    const carried = hrefLabelled(form, 'Back to sign in') ?? '';
    const query = new URL(carried, 'https://x').searchParams;
    expect(query.get('state')).toBe(STATE);
    expect(query.get('nonce')).toBe(NONCE);
    expect(query.get('code_challenge')).toBe(CHALLENGE);
    expect(query.get('prompt')).toBe('login');

    const username = `c${newId().slice(-8)}`;
    const email = `${username}@example.test`;
    const password = `made up ${newId()} passphrase`;
    const registered = await request(
      'POST',
      `/tenants/${t.name}/login-actions/registration`,
      { username, email, password, password_confirm: password, return_to: carried },
      cookie,
    );
    expect(registered.statusCode).toBe(201);
    const verified = await pressButton(await mailedLink(email), cookie);
    expect(verified.statusCode).toBe(200);
    expect(hrefLabelled(verified, 'Continue to sign in')).toBe(carried);

    // The original request again, answered to the application with the
    // state it sent, by the account the person just made.
    const resumed = await request('GET', carried, undefined, cookie);
    expect(resumed.statusCode).toBe(200);
    expect(await parkedRequestOf(authSessionIdOf(resumed))).toMatchObject({
      clientId: 'portal',
      redirectUri: REDIRECT_URI,
      state: STATE,
      nonce: NONCE,
      codeChallenge: CHALLENGE,
    });
    const signedIn = await request(
      'POST',
      `/tenants/${t.name}/login-actions/authenticate`,
      { auth_session_id: authSessionIdOf(resumed), username, password },
      cookie,
    );
    expect(signedIn.statusCode).toBe(302);
    const answered = new URL(String(signedIn.headers.location));
    expect(`${answered.origin}${answered.pathname}`).toBe(REDIRECT_URI);
    expect(answered.searchParams.get('state')).toBe(STATE);
    expect(answered.searchParams.has('code')).toBe(true);
  });
});

describe('the same link, anywhere the sign-in is not held', () => {
  it('shows a different browser no Continue link, and says what to do', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Create an account');
    const username = `w${newId().slice(-8)}`;
    const email = `${username}@example.test`;
    await request(
      'POST',
      `/tenants/${t.name}/login-actions/registration`,
      {
        username,
        email,
        password: PASSWORD,
        password_confirm: PASSWORD,
        return_to: parked.carried,
      },
      parked.cookie,
    );
    const link = await mailedLink(email);

    const elsewhere = await pressButton(link, undefined);
    expect(elsewhere.statusCode).toBe(200);
    expect(elsewhere.body).not.toContain('Continue to sign in');
    expect(elsewhere.body).not.toContain('/protocol/openid-connect/auth');
    expect(elsewhere.body).toContain(
      'Return to the application you were signing in to and sign in.',
    );
  });

  it('shows a browser holding another sign-in of the same tenant no link', async () => {
    const t = await tenant();
    const first = await parkAndOpen(t, 'Forgot password?');
    const link = await askForReset(t, first, first.cookie);
    const second = await request('GET', authorizeUrl(t.name));

    const done = await resetPassword(t, link, cookieOf(second));
    expect(done.statusCode).toBe(200);
    expect(done.body).not.toContain('<a ');
  });

  it('shows a browser whose secret is not the sign-in’s no link', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Forgot password?');
    const link = await askForReset(t, parked, parked.cookie);
    const forged = `odudu-sign-in=${parked.authSessionId}.${'A'.repeat(43)}`;

    const done = await resetPassword(t, link, forged);
    expect(done.body).not.toContain('<a ');
  });

  it('shows no link once the parked sign-in has expired', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Forgot password?');
    const link = await askForReset(t, parked, parked.cookie);
    await owner.db
      .update(authenticationSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authenticationSessions.id, parked.authSessionId));

    const done = await resetPassword(t, link, parked.cookie);
    expect(done.statusCode).toBe(200);
    expect(done.body).not.toContain('<a ');
  });

  it('shows no link once a sign-in has consumed the parked one', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Forgot password?');
    const link = await askForReset(t, parked, parked.cookie);
    await owner.db
      .update(authenticationSessions)
      .set({ consumedAt: new Date() })
      .where(eq(authenticationSessions.id, parked.authSessionId));

    const done = await resetPassword(t, link, parked.cookie);
    expect(done.body).not.toContain('<a ');
  });

  it('names no sign-in when the form came from another tab than the cookie names', async () => {
    const t = await tenant();
    const firstTab = await parkAndOpen(t, 'Forgot password?');
    const secondLogin = await request('GET', authorizeUrl(t.name).replace(STATE, 'other-state'));
    const link = await askForReset(t, firstTab, cookieOf(secondLogin));

    const [token] = await owner.db
      .select()
      .from(actionTokens)
      .where(eq(actionTokens.tenantId, t.id))
      .orderBy(desc(actionTokens.createdAt));
    expect(token?.authenticationSessionId).toBeNull();
    const done = await resetPassword(t, link, cookieOf(secondLogin));
    expect(done.body).not.toContain('<a ');
  });

  it('never resumes a sign-in of one tenant through a link of another', async () => {
    const a = await tenant();
    const b = await tenant();
    const parkedInA = await parkAndOpen(a, 'Forgot password?');
    // A link of tenant B whose row names tenant A's parked sign-in, which
    // the flow never writes: row-level security is what makes it read as none.
    const link = await askForReset(b, await parkAndOpen(b, 'Forgot password?'), undefined);
    await owner.db
      .update(actionTokens)
      .set({ authenticationSessionId: parkedInA.authSessionId })
      .where(and(eq(actionTokens.tenantId, b.id)));

    const done = await resetPassword(b, link, parkedInA.cookie);
    expect(done.statusCode).toBe(200);
    expect(done.body).not.toContain('<a ');
    expect(done.body).not.toContain(`/tenants/${a.name}/`);
  });

  it('shows the same bytes for a reference that names no sign-in and one that names none at all', async () => {
    const t = await tenant();
    const bodies = new Set<string>();
    for (const reference of [null, newId(), newId()]) {
      const parked = await parkAndOpen(t, 'Forgot password?');
      const link = await askForReset(t, parked, undefined);
      await owner.db
        .update(actionTokens)
        .set({ authenticationSessionId: reference })
        .where(eq(actionTokens.tenantId, t.id));
      const done = await resetPassword(t, link, parked.cookie);
      bodies.add(done.body);
    }
    expect(bodies.size).toBe(1);
  });
});

describe('what a request names is not trusted', () => {
  it('ignores a way back the request carries, and a dead posted key still fails', async () => {
    const t = await tenant();
    const parked = await parkAndOpen(t, 'Forgot password?');
    const link = await askForReset(t, parked, parked.cookie);
    const evil = encodeURIComponent('https://evil.example/x');
    const page = await request('GET', `${link}&return_to=${evil}`, undefined, parked.cookie);
    expect(page.body).not.toContain('evil.example');

    const dead = await request('POST', `/tenants/${t.name}/login-actions/action-token`, {
      key: 'x'.repeat(43),
      password: '',
    });
    expect(dead.statusCode).toBe(400);
    expect(dead.body).toContain('This link can&#39;t be used');
    expect(dead.body).not.toContain('<form');
  });
});
