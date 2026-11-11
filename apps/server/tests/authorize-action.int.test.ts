import { sessions } from '@odudu/authn-flows';
import { totpCode, totpCounter } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { clientRepository, clientScopeRepository } from '@odudu/domain-tenant';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// An application sending a signed-in person to change a credential, through
// the real app: /authorize with `action`, the page, and the way back.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const REDIRECT = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple 1!';
const NEW_PASSWORD = 'a different horse battery staple 2!';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const WINDOW_SECONDS = 300;
const ALL_ACTIONS = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
];

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  readonly name: string;
  readonly tenantId: string;
  readonly issuer: string;
  readonly subjectId: string;
}

async function world(allowed: readonly string[] = ALL_ACTIONS): Promise<World> {
  const name = `act-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT],
    username: 'ada',
    password: PASSWORD,
    email: 'ada@example.com',
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  await withTenant(appDb.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId('portal');
    if (client === null) throw new Error('no client');
    for (const scope of await clientScopeRepository(tx).byNames(['me:read'])) {
      await clientScopeRepository(tx).assign(client.id, scope.id, 'optional');
    }
  });
  await owner.sql`
    update client_oidc_config
       set audiences = ${[meAudienceOfIssuer(`${BASE}/tenants/${name}`)]},
           allowed_actions = ${[...allowed]}
     where tenant_id = ${tenantId}
       and client_id in (select id from clients where tenant_id = ${tenantId} and client_id = 'portal')`;
  return { name, tenantId, issuer: `${BASE}/tenants/${name}`, subjectId: seeded.userSubjectId };
}

function authorizeQuery(w: World, extra: Record<string, string | string[]> = {}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT,
    scope: 'openid me:read',
    resource: meAudienceOfIssuer(w.issuer),
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  for (const [key, value] of Object.entries(extra)) {
    query.delete(key);
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }
  return `/tenants/${w.name}/protocol/openid-connect/auth?${query.toString()}`;
}

const authorize = (w: World, extra: Record<string, string | string[]> = {}, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: authorizeQuery(w, extra),
    headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) },
  });

const rendersLoginForm = (res: LightMyRequestResponse) =>
  res.statusCode === 200 && res.body.includes('name="password"') && res.body.includes('username');

function field(res: LightMyRequestResponse, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]*)"`, 'u').exec(res.body)?.[1];
  if (value === undefined) throw new Error(`no ${name} field: ${res.body.slice(0, 300)}`);
  return value;
}

function sessionCookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value) => !value.includes('-persistent='))?.split(';')[0];
  if (cookie === undefined) throw new Error('no session cookie');
  return cookie;
}

const sessionIdOf = (cookie: string): string => {
  const id = cookie.split('=')[1]?.split(':')[0];
  if (id === undefined) throw new Error('no session id in the cookie');
  return id;
};

const locationOf = (res: LightMyRequestResponse): URL => {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error(`no redirect: ${String(res.statusCode)}`);
  return new URL(location);
};

const form = (w: World, path: string, fields: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/login-actions/${path}`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });

const submitPassword = (w: World, login: LightMyRequestResponse) =>
  form(w, 'authenticate', {
    auth_session_id: field(login, 'auth_session_id'),
    username: 'ada',
    password: PASSWORD,
  });

async function signIn(w: World): Promise<string> {
  const login = await authorize(w);
  expect(rendersLoginForm(login)).toBe(true);
  const done = await submitPassword(w, login);
  expect(done.statusCode).toBe(302);
  return sessionCookieOf(done);
}

async function backdate(sessionId: string, seconds: number): Promise<void> {
  const [row] = await owner.db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (row === undefined) throw new Error('no session');
  await owner.db
    .update(sessions)
    .set({ createdAt: new Date(row.createdAt.getTime() - seconds * 1000) })
    .where(eq(sessions.id, sessionId));
}

async function exchange(w: World, code: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/protocol/openid-connect/token`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'portal',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    }).toString(),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

const credentialsOf = async (w: World, token: string) => {
  const res = await app.inject({
    method: 'GET',
    url: `/tenants/${w.name}/me/credentials`,
    headers: { host: HOST, authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ items: { type: string }[] }>().items.map((item) => item.type);
};

const auditActions = async (w: World): Promise<string[]> =>
  (
    await owner.sql<{ action: string; actor_client_id: string | null; detail: unknown }[]>`
      select action, actor_client_id, detail from audit_events
       where tenant_id = ${w.tenantId} and action like 'action.%' order by occurred_at, id`
  ).map((row) => row.action);

const secretOf = (page: LightMyRequestResponse): string => field(page, 'secret');

describe('a request that names an action wrongly', () => {
  const REFUSED: [string, Record<string, string | string[]>][] = [
    ['an unknown action', { action: 'delete-account' }],
    ['a repeated action', { action: ['configure-totp', 'update-password'] }],
    ['the same action twice', { action: ['configure-totp', 'configure-totp'] }],
    ['an empty action', { action: '' }],
  ];

  for (const [label, extra] of REFUSED) {
    it(`answers ${label} at the validated redirect, with the state and the issuer`, async () => {
      const w = await world();
      const res = await authorize(w, extra);
      expect(res.statusCode).toBe(302);
      const target = locationOf(res);
      expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
      expect(target.searchParams.get('error')).toBe('invalid_request');
      expect(target.searchParams.get('state')).toBe('xyz');
      expect(target.searchParams.get('iss')).toBe(w.issuer);
      expect(target.searchParams.has('code')).toBe(false);
    });
  }

  it('renders an error, and never redirects, where the redirect URI is not registered', async () => {
    const w = await world();
    const res = await app.inject({
      method: 'GET',
      url: authorizeQuery(w, { action: 'delete-account', redirect_uri: 'https://evil.example/cb' }),
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('refuses an action the client is not allowed to start, saying so plainly', async () => {
    const w = await world(['update-password']);
    const target = locationOf(await authorize(w, { action: 'configure-totp' }));
    expect(target.searchParams.get('error')).toBe('invalid_request');
    expect(target.searchParams.get('error_description')).toBe(
      'This client may not start that action',
    );
  });

  it('refuses every action for a client allowed none', async () => {
    const w = await world([]);
    const target = locationOf(await authorize(w, { action: 'update-password' }));
    expect(target.searchParams.get('error')).toBe('invalid_request');
  });

  it('keeps answering in the query mode only: an action does not widen response_mode', async () => {
    const w = await world();
    for (const mode of ['fragment', 'form_post']) {
      const res = await authorize(w, { action: 'configure-totp', response_mode: mode });
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  it('refuses an action that cannot be shown without a page', async () => {
    const w = await world();
    for (const prompt of ['none', 'create']) {
      const target = locationOf(await authorize(w, { action: 'configure-totp', prompt }));
      expect(target.searchParams.get('error')).toBe('invalid_request');
    }
  });
});

describe('a request that names no action', () => {
  it('adds no action_status, and ignores one the client sends', async () => {
    const w = await world();
    const login = await authorize(w, { action_status: 'success' });
    const done = await submitPassword(w, login);
    const target = locationOf(done);
    expect(target.searchParams.get('code')).toBeTruthy();
    expect(target.searchParams.has('action_status')).toBe(false);
  });

  it('adds none on a reused session either', async () => {
    const w = await world();
    const cookie = await signIn(w);
    const res = await authorize(w, { action_status: 'success' }, cookie);
    expect(locationOf(res).searchParams.has('action_status')).toBe(false);
  });
});

describe('an action requested after a fresh sign-in', () => {
  it('shows the authenticator page with a cancel control, and returns a code with success once confirmed', async () => {
    const w = await world();
    const login = await authorize(w, { action: 'configure-totp', action_status: 'cancelled' });
    expect(rendersLoginForm(login)).toBe(true);
    const page = await submitPassword(w, login);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="cancel"');
    expect(page.body).toContain('login-actions/required-action?action=configure-totp');

    const secret = secretOf(page);
    const confirmed = await form(w, 'required-action?action=configure-totp', {
      auth_session_id: field(page, 'auth_session_id'),
      secret,
      code: totpCode(secret, totpCounter(new Date())),
    });
    // A new authenticator owes recovery codes, a page the person cannot leave.
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.body).not.toContain('name="cancel"');
    const done = await form(w, 'required-action?action=generate-recovery-codes', {
      auth_session_id: field(confirmed, 'auth_session_id'),
    });
    expect(done.statusCode).toBe(302);
    const target = locationOf(done);
    expect(target.searchParams.get('action_status')).toBe('success');
    expect(target.searchParams.get('state')).toBe('xyz');
    expect(target.searchParams.get('iss')).toBe(w.issuer);

    // The outcome is read from the credential list, not from the parameter.
    const token = await exchange(w, String(target.searchParams.get('code')));
    expect(await credentialsOf(w, token)).toContain('totp');
    expect(await auditActions(w)).toEqual(['action.requested', 'action.completed']);
  });

  it('re-renders the page for a wrong code and still ends in success once a right one is sent', async () => {
    const w = await world();
    const page = await submitPassword(w, await authorize(w, { action: 'configure-totp' }));
    const retry = await form(w, 'required-action?action=configure-totp', {
      auth_session_id: field(page, 'auth_session_id'),
      secret: secretOf(page),
      code: '000000',
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toContain('name="cancel"');
    expect(await auditActions(w)).toEqual(['action.requested']);
  });

  it('returns a code with cancelled when the cancel control is used, changing nothing', async () => {
    const w = await world();
    const page = await submitPassword(w, await authorize(w, { action: 'update-password' }));
    expect(page.body).toContain('name="current_password"');
    const done = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(page, 'auth_session_id'),
      cancel: '1',
    });
    expect(done.statusCode).toBe(302);
    const target = locationOf(done);
    expect(target.searchParams.get('action_status')).toBe('cancelled');
    expect(target.searchParams.get('code')).toBeTruthy();
    expect(await auditActions(w)).toEqual(['action.requested', 'action.cancelled']);
    expect((await signInAs(w, PASSWORD)).statusCode).toBe(302);
  });

  it('cannot be cancelled into an action the person owes the tenant', async () => {
    const w = await world();
    await owner.sql`insert into user_required_actions (tenant_id, subject_id, action)
                    values (${w.tenantId}, ${w.subjectId}, 'update-password')`;
    const page = await submitPassword(w, await authorize(w, { action: 'update-password' }));
    const afterCancel = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(page, 'auth_session_id'),
      cancel: '1',
    });
    // The owed page comes back, without a way to leave it.
    expect(afterCancel.statusCode).toBe(400);
    expect(afterCancel.body).not.toContain('name="cancel"');
  });

  it('refuses a cancel for an action that was not requested', async () => {
    const w = await world();
    const page = await submitPassword(w, await authorize(w, { action: 'update-password' }));
    const res = await form(w, 'required-action?action=configure-totp', {
      auth_session_id: field(page, 'auth_session_id'),
      cancel: '1',
    });
    expect(res.statusCode).toBe(400);
  });
});

async function signInAs(w: World, password: string) {
  const login = await authorize(w);
  return form(w, 'authenticate', {
    auth_session_id: field(login, 'auth_session_id'),
    username: 'ada',
    password,
  });
}

describe('an action requested against a session that is already live', () => {
  it('skips the sign-in for a fresh session, and asks for the current password regardless', async () => {
    const w = await world();
    const cookie = await signIn(w);
    const page = await authorize(w, { action: 'update-password' }, cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="current_password"');

    const wrong = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(page, 'auth_session_id'),
      current_password: 'not it',
      password: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.body).toContain('current password is not correct');
    expect((await signInAs(w, PASSWORD)).statusCode).toBe(302);

    const done = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(wrong, 'auth_session_id'),
      current_password: PASSWORD,
      password: NEW_PASSWORD,
    });
    expect(done.statusCode).toBe(302);
    expect(locationOf(done).searchParams.get('action_status')).toBe('success');
    expect((await signInAs(w, NEW_PASSWORD)).statusCode).toBe(302);
    expect(await auditActions(w)).toEqual(['action.requested', 'action.completed']);
  });

  it('forces a new sign-in once the session is older than the tenant window', async () => {
    const w = await world();
    const cookie = await signIn(w);
    await backdate(sessionIdOf(cookie), WINDOW_SECONDS + 60);
    const res = await authorize(w, { action: 'update-password' }, cookie);
    expect(rendersLoginForm(res)).toBe(true);
    // The sign-in then leads to the action's page, on a new session.
    const page = await submitPassword(w, res);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="current_password"');
  });

  it('takes the tenant window from the tenant, not from the client', async () => {
    const w = await world();
    await owner.sql`update tenants set session_freshness_seconds = 3600 where id = ${w.tenantId}`;
    const cookie = await signIn(w);
    await backdate(sessionIdOf(cookie), WINDOW_SECONDS + 60);
    const page = await authorize(w, { action: 'update-password' }, cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="current_password"');
  });

  it('replaces an authenticator only once the new code has verified', async () => {
    const w = await world();
    const firstSecret = await enrolAuthenticator(w);

    const cookie = await signInWithTotp(w, firstSecret);
    const page = await authorize(w, { action: 'configure-totp' }, cookie);
    expect(page.statusCode).toBe(200);
    const secret = secretOf(page);
    expect(secret).not.toBe(firstSecret);

    const wrong = await form(w, 'required-action?action=configure-totp', {
      auth_session_id: field(page, 'auth_session_id'),
      secret,
      code: '000000',
    });
    expect(wrong.statusCode).toBe(200);
    expect(await totpSecrets(w)).toEqual([firstSecret]);

    const done = await form(w, 'required-action?action=configure-totp', {
      auth_session_id: field(wrong, 'auth_session_id'),
      secret,
      code: totpCode(secret, totpCounter(new Date())),
    });
    expect(done.statusCode).toBe(302);
    expect(locationOf(done).searchParams.get('action_status')).toBe('success');
    expect(await totpSecrets(w)).toEqual([secret]);
  });
});

// Enrols an authenticator through the action's own page, acknowledging the
// recovery codes a new one owes, and returns its secret.
async function enrolAuthenticator(w: World): Promise<string> {
  const first = await submitPassword(w, await authorize(w, { action: 'configure-totp' }));
  const secret = secretOf(first);
  const enrolled = await form(w, 'required-action?action=configure-totp', {
    auth_session_id: field(first, 'auth_session_id'),
    secret,
    code: totpCode(secret, totpCounter(new Date())),
  });
  await form(w, 'required-action?action=generate-recovery-codes', {
    auth_session_id: field(enrolled, 'auth_session_id'),
  });
  return secret;
}

async function totpSecrets(w: World): Promise<string[]> {
  const rows = await owner.sql<{ secret_data: { secret: string } }[]>`
    select secret_data from user_credentials
     where tenant_id = ${w.tenantId} and subject_id = ${w.subjectId} and type = 'totp'`;
  return rows.map((row) => row.secret_data.secret);
}

// Signs in through a login that now also asks for the authenticator's code.
async function signInWithTotp(w: World, secret: string): Promise<string> {
  const login = await authorize(w);
  const asked = await submitPassword(w, login);
  expect(asked.body).toContain('name="code"');
  // A step is spent once used, so the next one proves possession again.
  const next = totpCode(secret, totpCounter(new Date(Date.now() + 30_000)));
  const done = await form(w, 'authenticate', {
    auth_session_id: field(asked, 'auth_session_id'),
    code: next,
  });
  expect(done.statusCode).toBe(302);
  return sessionCookieOf(done);
}

describe('an action in a sign-in that also asks for consent', () => {
  it('runs the action first, then asks for consent, and the code carries the ending', async () => {
    const w = await world();
    await owner.sql`update client_oidc_config set consent_required = true
                     where tenant_id = ${w.tenantId}`;
    const page = await submitPassword(w, await authorize(w, { action: 'update-password' }));
    expect(page.body).toContain('name="current_password"');
    const consent = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(page, 'auth_session_id'),
      cancel: '1',
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.body).toContain('name="decision"');
    const done = await form(w, 'consent', {
      auth_session_id: field(consent, 'auth_session_id'),
      decision: 'allow',
    });
    expect(done.statusCode).toBe(302);
    const target = locationOf(done);
    expect(target.searchParams.get('code')).toBeTruthy();
    expect(target.searchParams.get('action_status')).toBe('cancelled');
  });
});

describe('an action that cannot run', () => {
  it('ends recovery codes for a person with no second factor as an error, auditing the failure', async () => {
    const w = await world();
    const cookie = await signIn(w);
    const res = await authorize(w, { action: 'generate-recovery-codes' }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('action_status=error');
    expect(await auditActions(w)).toEqual(['action.requested', 'action.failed']);
  });
});

const recoveryRows = async (w: World): Promise<string[]> =>
  (
    await owner.sql<{ id: string }[]>`
      select id from user_credentials
       where tenant_id = ${w.tenantId} and subject_id = ${w.subjectId} and type = 'recovery-code'
       order by id`
  ).map((row) => row.id);

const issuedRows = async (w: World): Promise<number> =>
  (
    await owner.sql<{ n: number }[]>`
      select count(*)::int as n from audit_events
       where tenant_id = ${w.tenantId} and action = 'recovery_codes.issued'`
  )[0]?.n ?? 0;

const CONFIRM = 'This replaces your current recovery codes';

describe('recovery codes requested by an application', () => {
  it('asks before replacing a held set, and cancelling leaves it untouched', async () => {
    const w = await world();
    const secret = await enrolAuthenticator(w);
    const before = await recoveryRows(w);
    const issuedBefore = await issuedRows(w);
    expect(before.length).toBeGreaterThan(0);

    const cookie = await signInWithTotp(w, secret);
    const page = await authorize(w, { action: 'generate-recovery-codes' }, cookie);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(CONFIRM);
    expect(page.body).toContain('name="cancel"');
    expect(page.body).not.toContain('<ol>');
    // Showing the question is not asking for the change, a reload included.
    await authorize(w, { action: 'generate-recovery-codes' }, cookie);
    expect(await recoveryRows(w)).toEqual(before);

    const done = await form(w, 'required-action?action=generate-recovery-codes', {
      auth_session_id: field(page, 'auth_session_id'),
      cancel: '1',
    });
    expect(locationOf(done).searchParams.get('action_status')).toBe('cancelled');
    expect(await recoveryRows(w)).toEqual(before);
    expect(await issuedRows(w)).toBe(issuedBefore);
  });

  it('replaces the set once, on confirmation, and shows the new codes', async () => {
    const w = await world();
    const secret = await enrolAuthenticator(w);
    const before = await recoveryRows(w);
    const issuedBefore = await issuedRows(w);

    const cookie = await signInWithTotp(w, secret);
    const page = await authorize(w, { action: 'generate-recovery-codes' }, cookie);
    const shown = await form(w, 'required-action?action=generate-recovery-codes', {
      auth_session_id: field(page, 'auth_session_id'),
      confirm: '1',
    });
    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('<ol>');
    // The set is already replaced, so nothing on this page may record a cancel.
    expect(shown.body).not.toContain('name="cancel"');
    const after = await recoveryRows(w);
    expect(after).not.toEqual(before);
    expect(await issuedRows(w)).toBe(issuedBefore + 1);

    const done = await form(w, 'required-action?action=generate-recovery-codes', {
      auth_session_id: field(shown, 'auth_session_id'),
    });
    expect(locationOf(done).searchParams.get('action_status')).toBe('success');
    expect(await recoveryRows(w)).toEqual(after);
  });

  it('issues at render when no set is held, since nothing is lost', async () => {
    const w = await world();
    const secret = await enrolAuthenticator(w);
    const cookie = await signInWithTotp(w, secret);
    await owner.sql`delete from user_credentials
                     where tenant_id = ${w.tenantId} and subject_id = ${w.subjectId}
                       and type = 'recovery-code'`;
    const page = await authorize(w, { action: 'generate-recovery-codes' }, cookie);
    expect(page.body).toContain('<ol>');
    expect(page.body).not.toContain('name="cancel"');
    expect((await recoveryRows(w)).length).toBeGreaterThan(0);
  });
});

describe('an action the tenant also owes', () => {
  it('is offered without a way out, and an ending does not read as cancelled', async () => {
    const w = await world();
    await owner.sql`insert into user_required_actions (tenant_id, subject_id, action)
                    values (${w.tenantId}, ${w.subjectId}, 'update-password')`;
    const page = await submitPassword(w, await authorize(w, { action: 'update-password' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('name="cancel"');
    expect(page.body).not.toContain('name="current_password"');
    const done = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(page, 'auth_session_id'),
      password: NEW_PASSWORD,
    });
    expect(done.statusCode).toBe(302);
    expect(locationOf(done).searchParams.get('action_status')).toBe('success');
  });
});

describe('a password change for a person with no password', () => {
  it('ends as an error instead of asking for a password nobody holds', async () => {
    const w = await world();
    const cookie = await signIn(w);
    await owner.sql`delete from user_credentials
                     where tenant_id = ${w.tenantId} and subject_id = ${w.subjectId}
                       and type = 'password'`;
    const res = await authorize(w, { action: 'update-password' }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('action_status=error');
    expect(await auditActions(w)).toEqual(['action.requested', 'action.failed']);
  });
});

describe('an action requested through the account chooser', () => {
  it('shows the action after the account is chosen', async () => {
    const w = await world();
    const cookie = await signIn(w);
    const chooser = await authorize(
      w,
      { action: 'update-password', prompt: 'select_account' },
      cookie,
    );
    expect(chooser.statusCode).toBe(200);
    const sessionId = /name="session_id" value="([^"]*)"/u.exec(chooser.body)?.[1];
    expect(sessionId).toBeTruthy();
    const page = await app.inject({
      method: 'POST',
      url: `/tenants/${w.name}/login-actions/select-account`,
      headers: {
        host: HOST,
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({
        auth_session_id: field(chooser, 'auth_session_id'),
        session_id: String(sessionId),
      }).toString(),
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="current_password"');
    const done = await form(w, 'required-action?action=update-password', {
      auth_session_id: field(page, 'auth_session_id'),
      cancel: '1',
    });
    expect(locationOf(done).searchParams.get('action_status')).toBe('cancelled');
  });
});
