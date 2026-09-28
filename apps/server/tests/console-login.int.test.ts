import { unwrapSecret } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { ADMIN_CLIENT_ID, SYSTEM_TENANT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { FakeClock, loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seedAdmin } from '#/cli/seed';
import { createLogger } from '#/logger';

// The console's sign-in through the real composition: the gateway is an
// ordinary public client of the server it is mounted in, so each test here
// plays the browser end to end — the gateway's redirect, the server's own
// login form and forced password change, and the callback back into the
// gateway.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
const BASE_HOST = 'console.example.test';
const BASE = `http://${BASE_HOST}`;
const ISSUER = `${BASE}/tenants/${SYSTEM_TENANT_NAME}`;
const REDIRECT_URI = `${BASE}/console/auth/callback`;
const NEW_PASSWORD = 'Str0ng-Passw0rd!42';
const LOGIN_COOKIE = 'odudu-console-login';
const SESSION_COOKIE = 'odudu-console';
const RETURN_TO = '/console/tenants/system/clients?page=2';
const REFUSAL = 'sign-in could not be completed';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;
  process.env.ODUDU_DATABASE_URL = containerHandle.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  // Creates the system tenant and its admin client, which a sign-in has to
  // find before any administrator of its own is seeded.
  await seedAdmin({ username: `setup-${newId()}` });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface TestApp {
  readonly app: FastifyInstance;
  readonly clock: FakeClock;
  readonly logs: string[];
  // Every /token response body the server sent, the gateway's included.
  readonly tokenResponses: string[];
}

async function startApp(): Promise<TestApp> {
  const logs: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'trace' });
  const clock = new FakeClock(new Date());
  const app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config, destination),
    publicBaseUrl: BASE,
    consoleBaseUrl: BASE,
    consoleNow: () => clock.now(),
  });
  const tokenResponses: string[] = [];
  app.addHook('onSend', async (request, _reply, payload) => {
    if (request.url.endsWith('/protocol/openid-connect/token') && typeof payload === 'string') {
      tokenResponses.push(payload);
    }
    return payload;
  });
  await app.ready();
  return { app, clock, logs, tokenResponses };
}

class Jar {
  readonly cookies = new Map<string, string>();

  take(res: LightMyRequestResponse): void {
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }

  header(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  }
}

async function browse(
  app: FastifyInstance,
  jar: Jar,
  url: string,
  host = BASE_HOST,
): Promise<LightMyRequestResponse> {
  const res = await app.inject({ url, headers: { host, ...jar.header() } });
  jar.take(res);
  return res;
}

async function post(
  app: FastifyInstance,
  jar: Jar,
  url: string,
  fields: Record<string, string>,
): Promise<LightMyRequestResponse> {
  const res = await app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: {
      host: BASE_HOST,
      'content-type': 'application/x-www-form-urlencoded',
      ...jar.header(),
    },
  });
  jar.take(res);
  return res;
}

function field(body: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]*)"`, 'u').exec(body)?.[1];
  if (value === undefined) throw new Error(`${name} not found`);
  return value;
}

function pathOf(location: string): string {
  const url = new URL(location, BASE);
  return url.pathname + url.search;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

async function beginLogin(
  app: FastifyInstance,
  jar: Jar,
  host = BASE_HOST,
): Promise<{ authorize: URL; state: string }> {
  const query = new URLSearchParams({ tenant: SYSTEM_TENANT_NAME, return_to: RETURN_TO });
  const res = await browse(app, jar, `/console/auth/login?${query.toString()}`, host);
  expect(res.statusCode).toBe(302);
  const authorize = new URL(String(res.headers.location));
  return { authorize, state: authorize.searchParams.get('state') ?? '' };
}

// Signs a freshly seeded administrator in at the server's own login form,
// through its forced password change, and answers the callback URL the
// authorization endpoint redirected to.
async function signInAtOp(
  app: FastifyInstance,
  jar: Jar,
  authorize: URL,
): Promise<{ callback: string; subjectId: string }> {
  const username = `ada-${newId()}`;
  const { password, subjectId } = await seedAdmin({ username });
  const page = await browse(app, jar, authorize.pathname + authorize.search);
  const actions = `/tenants/${SYSTEM_TENANT_NAME}/login-actions`;
  const first = await post(app, jar, `${actions}/authenticate`, {
    auth_session_id: field(page.body, 'auth_session_id'),
    username,
    password,
  });
  const changed = await post(app, jar, `${actions}/required-action?action=update-password`, {
    auth_session_id: field(first.body, 'auth_session_id'),
    password: NEW_PASSWORD,
  });
  const signedIn = await post(app, jar, `${actions}/authenticate`, {
    auth_session_id: field(changed.body, 'auth_session_id'),
    username,
    password: NEW_PASSWORD,
  });
  expect(signedIn.statusCode).toBe(302);
  const callback = String(signedIn.headers.location);
  expect(callback.startsWith(`${REDIRECT_URI}?`)).toBe(true);
  return { callback, subjectId };
}

async function sessionsFor(subjectId: string): Promise<Record<string, unknown>[]> {
  return owner.db.execute(sql`SELECT * FROM console_sessions WHERE subject_id = ${subjectId}`);
}

function expectRefused(res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain(REFUSAL);
  expect(res.headers['set-cookie'] ?? '').not.toContain(`${SESSION_COOKIE}=`);
}

function claimsOf(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('GET /console/auth/login', () => {
  it('redirects to the tenant authorization endpoint as the admin client', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(app, jar);
      expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
      const params = Object.fromEntries(authorize.searchParams);
      expect(params).toMatchObject({
        response_type: 'code',
        client_id: ADMIN_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'openid',
        resource: 'urn:odudu:params:admin-api',
        code_challenge_method: 'S256',
      });
      expect(params.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(state.startsWith(`${SYSTEM_TENANT_ID}.`)).toBe(true);
      expect(jar.cookies.get(LOGIN_COOKIE)).toBe(state);

      const rows = (await owner.db.execute(
        sql`SELECT * FROM console_logins WHERE state_hash = ${sha256(state)}`,
      )) as unknown as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.return_to).toBe(RETURN_TO);
      expect(rows[0]?.nonce).toBe(params.nonce);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['an invalid tenant name', 'Not_A_Tenant'],
    ['an unknown tenant', 'no-such-tenant'],
    ['no tenant at all', undefined],
  ])('refuses %s', async (_label, tenant) => {
    const { app } = await startApp();
    try {
      const query = tenant === undefined ? '' : `?tenant=${tenant}`;
      const res = await browse(app, new Jar(), `/console/auth/login${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(REFUSAL);
      expect(res.headers['set-cookie']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('GET /console/auth/callback', () => {
  it('signs the administrator in and keeps every secret out of logs and audit', async () => {
    const { app, logs } = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(app, jar);
      const login = (await owner.db.execute(
        sql`SELECT verifier_wrapped, nonce FROM console_logins WHERE state_hash = ${sha256(state)}`,
      )) as unknown as { verifier_wrapped: string; nonce: string }[];
      const verifier = unwrapSecret(login[0]?.verifier_wrapped ?? '', KEK);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      const code = new URL(callback).searchParams.get('code') ?? '';

      const res = await browse(app, jar, pathOf(callback));

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(RETURN_TO);
      expect(jar.cookies.has(LOGIN_COOKIE)).toBe(false);
      const cookieValue = jar.cookies.get(SESSION_COOKIE) ?? '';
      const [cookieTenant, cookieSecret = ''] = cookieValue.split('.');
      expect(cookieTenant).toBe(SYSTEM_TENANT_ID);

      const sessions = await sessionsFor(subjectId);
      expect(sessions).toHaveLength(1);
      const session = sessions[0] ?? {};
      expect(session.tenant_id).toBe(SYSTEM_TENANT_ID);
      expect(session.secret_hash).toEqual(sha256(cookieSecret));
      const idToken = unwrapSecret(String(session.id_token_wrapped), KEK);
      const accessToken = unwrapSecret(String(session.access_token_wrapped), KEK);
      const refreshToken = unwrapSecret(String(session.refresh_token_wrapped), KEK);
      expect(claimsOf(idToken)).toMatchObject({
        iss: ISSUER,
        aud: ADMIN_CLIENT_ID,
        sub: subjectId,
      });
      expect(claimsOf(accessToken).iss).toBe(ISSUER);
      const created = new Date(String(session.created_at)).getTime();
      expect(new Date(String(session.expires_at)).getTime() - created).toBe(12 * 60 * 60 * 1000);

      const audit = (await owner.db.execute(
        sql`SELECT detail::text AS detail FROM audit_events`,
      )) as unknown as { detail: string | null }[];
      const exposed = [
        logs.join('\n'),
        audit.map((row) => row.detail ?? '').join('\n'),
        res.body,
      ].join('\n');
      const secrets = {
        code,
        state,
        verifier,
        nonce: login[0]?.nonce ?? '',
        cookieSecret,
        idToken,
        accessToken,
        refreshToken,
      };
      expect(logs.length).toBeGreaterThan(0);
      for (const [name, secret] of Object.entries(secrets)) {
        expect(secret.length, name).toBeGreaterThan(20);
        expect(exposed.includes(secret), name).toBe(false);
      }
    } finally {
      await app.close();
    }
  });

  it('completes against the base issuer whatever Host the browser sends', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(app, jar, 'evil.example');
      expect(authorize.origin).toBe(BASE);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      expect(new URL(callback).searchParams.get('iss')).toBe(ISSUER);

      const res = await browse(app, jar, pathOf(callback), 'evil.example');

      expect(res.statusCode).toBe(302);
      expect(await sessionsFor(subjectId)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('refuses a missing or mismatched login cookie, and still accepts the right one', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(app, jar);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);

      jar.cookies.delete(LOGIN_COOKIE);
      expectRefused(await browse(app, jar, pathOf(callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);

      jar.cookies.set(LOGIN_COOKIE, `${SYSTEM_TENANT_ID}.bm90LXRoZS1zdGF0ZQ`);
      expectRefused(await browse(app, jar, pathOf(callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);

      jar.cookies.set(LOGIN_COOKIE, state);
      expect((await browse(app, jar, pathOf(callback))).statusCode).toBe(302);
      expect(await sessionsFor(subjectId)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('refuses a replayed state', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(app, jar);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      expect((await browse(app, jar, pathOf(callback))).statusCode).toBe(302);

      jar.cookies.set(LOGIN_COOKIE, state);
      expectRefused(await browse(app, jar, pathOf(callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('refuses a login that has expired', async () => {
    const { app, clock } = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(app, jar);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      clock.advance(11 * 60 * 1000);

      expectRefused(await browse(app, jar, pathOf(callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('refuses an iss naming another tenant', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(app, jar);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      const forged = new URL(callback);
      forged.searchParams.set('iss', `${BASE}/tenants/acme`);

      expectRefused(await browse(app, jar, pathOf(forged.toString())));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('refuses an ID token whose nonce is not the login’s, and revokes its grant', async () => {
    const { app, tokenResponses } = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(app, jar);
      await owner.db.execute(
        sql`UPDATE console_logins SET nonce = 'tampered' WHERE state_hash = ${sha256(state)}`,
      );
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);

      expectRefused(await browse(app, jar, pathOf(callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);

      expect(tokenResponses).toHaveLength(1);
      const { refresh_token: refreshToken } = JSON.parse(tokenResponses[0] ?? '{}') as {
        refresh_token: string;
      };
      const refreshed = await post(
        app,
        new Jar(),
        `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/token`,
        { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: ADMIN_CLIENT_ID },
      );
      expect(refreshed.statusCode).toBe(400);
      expect(refreshed.json<{ error: string }>().error).toBe('invalid_grant');
    } finally {
      await app.close();
    }
  });

  it('refuses a callback that names no issuer', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(app, jar);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      const stripped = new URL(callback);
      stripped.searchParams.delete('iss');

      expectRefused(await browse(app, jar, pathOf(stripped.toString())));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('refuses a state and cookie whose tenant prefix was edited, leaving the login', async () => {
    const { app } = await startApp();
    try {
      const other = newId();
      await owner.db.execute(
        sql`INSERT INTO tenants (id, name) VALUES (${other}, ${`edited-${other.slice(-12)}`})`,
      );
      const jar = new Jar();
      const { authorize, state } = await beginLogin(app, jar);
      const { callback, subjectId } = await signInAtOp(app, jar, authorize);
      const edited = `${other}.${state.split('.')[1] ?? ''}`;
      const forged = new URL(callback);
      forged.searchParams.set('state', edited);
      jar.cookies.set(LOGIN_COOKIE, edited);

      expectRefused(await browse(app, jar, pathOf(forged.toString())));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
      const left = await owner.db.execute(
        sql`SELECT id FROM console_logins WHERE state_hash = ${sha256(state)}`,
      );
      expect(left).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('turns an error code outside the registered set into server_error', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { state } = await beginLogin(app, jar);
      const query = new URLSearchParams({ error: 'made_up_code', state, iss: ISSUER });

      const res = await browse(app, jar, `/console/auth/callback?${query.toString()}`);

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/console/?login_error=server_error');
    } finally {
      await app.close();
    }
  });

  it('passes on only the error code of an OP error response', async () => {
    const { app } = await startApp();
    try {
      const jar = new Jar();
      const { state } = await beginLogin(app, jar);
      const query = new URLSearchParams({
        error: 'access_denied',
        error_description: 'the user said no',
        state,
        iss: ISSUER,
      });

      const res = await browse(app, jar, `/console/auth/callback?${query.toString()}`);

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/console/?login_error=access_denied');
      expect(jar.cookies.has(LOGIN_COOKIE)).toBe(false);
      const left = await owner.db.execute(
        sql`SELECT id FROM console_logins WHERE state_hash = ${sha256(state)}`,
      );
      expect(left).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
