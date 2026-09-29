import { unwrapSecret } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { ADMIN_CLIENT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import {
  beginLogin,
  browse,
  holdSessionLock,
  type ConsoleStack,
  Jar,
  KEK,
  pathOf,
  post,
  signIn,
  startConsoleApp,
} from '#/testing/console-harness';

// The console's sign-out ends the gateway's session and hands the browser
// the tenant's RP-initiated logout URL, which only a navigation carrying
// the tenant's own SSO cookie can act on.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'http://console.example.test';
const ISSUER = `${BASE}/tenants/${SYSTEM_TENANT_NAME}`;
const SESSION_COOKIE = 'odudu-console';
const SSO_COOKIE_PREFIX = `${SYSTEM_TENANT_NAME}-session`;
const WRITE = { origin: BASE, 'x-odudu-console': '1' };
const LOGOUT = '/console/auth/logout';

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

async function withStack(run: (stack: ConsoleStack) => Promise<void>): Promise<void> {
  const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
  try {
    await run(stack);
  } finally {
    await stack.app.close();
  }
}

async function logout(
  stack: ConsoleStack,
  jar: Jar,
  headers: Record<string, string> = WRITE,
): Promise<LightMyRequestResponse> {
  const res = await stack.app.inject({
    method: 'POST',
    url: LOGOUT,
    headers: { host: stack.base.host, ...headers, ...jar.header() },
  });
  jar.take(res);
  return res;
}

interface StoredSession {
  readonly idToken: string;
  readonly refreshToken: string;
}

async function consoleSessionsOf(subjectId: string): Promise<StoredSession[]> {
  const rows = await owner.db.execute<{ id_token_wrapped: string; refresh_token_wrapped: string }>(
    sql`SELECT id_token_wrapped, refresh_token_wrapped FROM console_sessions
        WHERE subject_id = ${subjectId}`,
  );
  return rows.map((row) => ({
    idToken: unwrapSecret(row.id_token_wrapped, KEK),
    refreshToken: unwrapSecret(row.refresh_token_wrapped, KEK),
  }));
}

async function onlySession(subjectId: string): Promise<StoredSession> {
  const sessions = await consoleSessionsOf(subjectId);
  expect(sessions).toHaveLength(1);
  const [session] = sessions;
  if (session === undefined) throw new Error('no console session');
  return session;
}

// Compares against the host's clock, not the container's: `expires_at` was
// written from `Date.now()`, and the two clocks are not the same clock.
async function ssoSessionsExpired(subjectId: string): Promise<boolean[]> {
  const rows = await owner.db.execute<{ expires_at: string }>(
    sql`SELECT expires_at::text FROM sessions WHERE subject_id = ${subjectId}`,
  );
  return rows.map((row) => new Date(row.expires_at).getTime() <= Date.now());
}

function ssoOnly(jar: Jar): Jar {
  const sso = new Jar();
  for (const [name, value] of jar.cookies) {
    if (name.startsWith(SSO_COOKIE_PREFIX)) sso.cookies.set(name, value);
  }
  expect(sso.cookies.size).toBeGreaterThan(0);
  return sso;
}

function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function expectSessionCookieCleared(res: LightMyRequestResponse): void {
  expect(
    setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && c.includes('Max-Age=0')),
  ).toBe(true);
}

function redirectOf(res: LightMyRequestResponse): string {
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/^application\/json/u);
  expect(res.headers['cache-control']).toBe('no-store');
  const body = res.json<{ redirect: string }>();
  expect(Object.keys(body)).toEqual(['redirect']);
  return body.redirect;
}

async function refreshAtOp(stack: ConsoleStack, refreshToken: string): Promise<string> {
  const res = await post(
    stack,
    new Jar(),
    `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/token`,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: ADMIN_CLIENT_ID },
  );
  expect(res.statusCode).toBe(400);
  return res.json<{ error: string }>().error;
}

// The authorization endpoint answers a browser still signed in with a
// redirect carrying a code, and one signed out with its login form.
async function authorizeWith(stack: ConsoleStack, sso: Jar): Promise<LightMyRequestResponse> {
  const { authorize } = await beginLogin(stack, new Jar());
  return browse(stack, sso, authorize.pathname + authorize.search);
}

describe('POST /console/auth/logout', () => {
  it('revokes the grant, deletes the session and answers the tenant’s logout URL', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const cookieSecret = (jar.cookies.get(SESSION_COOKIE) ?? '').split('.')[1] ?? '';
      const stored = await onlySession(subjectId);

      const res = await logout(stack, jar);

      const redirect = new URL(redirectOf(res));
      expect(`${redirect.origin}${redirect.pathname}`).toBe(
        `${ISSUER}/protocol/openid-connect/logout`,
      );
      expect(Object.fromEntries(redirect.searchParams)).toEqual({
        id_token_hint: stored.idToken,
        post_logout_redirect_uri: `${BASE}/console/`,
        client_id: ADMIN_CLIENT_ID,
      });
      expectSessionCookieCleared(res);
      expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
      expect(await consoleSessionsOf(subjectId)).toHaveLength(0);
      expect(await refreshAtOp(stack, stored.refreshToken)).toBe('invalid_grant');

      const logs = stack.logs.join('\n');
      for (const secret of [stored.idToken, stored.refreshToken, cookieSecret]) {
        expect(logs).not.toContain(secret);
      }
    });
  });

  it('ends the SSO session when the returned URL is followed with the tenant’s cookie', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const before = ssoOnly(jar);
      expect(await ssoSessionsExpired(subjectId)).toEqual([false]);

      const redirect = redirectOf(await logout(stack, jar));
      const followed = await browse(stack, jar, pathOf(stack, redirect));

      expect(followed.statusCode).toBe(302);
      expect(followed.headers.location).toBe(`${BASE}/console/`);
      expect(await ssoSessionsExpired(subjectId)).toEqual([true]);
      const replayed = await authorizeWith(stack, before);
      expect(replayed.statusCode).toBe(200);
      expect(replayed.body).toContain('name="password"');
    });
  });

  it('ends nothing when the same URL is followed without the SSO cookie', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const sso = ssoOnly(jar);

      const redirect = redirectOf(await logout(stack, jar));
      const followed = await browse(stack, new Jar(), pathOf(stack, redirect));

      expect(followed.statusCode).toBe(302);
      expect(followed.headers.location).toBe(`${BASE}/console/`);
      expect(setCookies(followed)).toEqual([]);
      expect(await ssoSessionsExpired(subjectId)).toEqual([false]);
      const signedBackIn = await authorizeWith(stack, sso);
      expect(signedBackIn.statusCode).toBe(302);
      expect(new URL(String(signedBackIn.headers.location)).searchParams.has('code')).toBe(true);
    });
  });

  it.each([
    ['no Origin or console header', {}],
    ['no console header', { origin: BASE }],
    ['another origin', { origin: 'http://evil.example.test', 'x-odudu-console': '1' }],
  ])('refuses a logout with %s, leaving the session standing', async (_label, headers) => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);

      const res = await logout(stack, jar, headers);

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(setCookies(res)).toEqual([]);
      expect(await consoleSessionsOf(subjectId)).toHaveLength(1);
      expect((await browse(stack, jar, '/console/api/session')).statusCode).toBe(200);
    });
  });

  it('gives up on a session lock held past five seconds with 502, keeping the session', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const release = await holdSessionLock(owner, subjectId);

      const res = await logout(stack, jar);
      await release();

      expect(res.statusCode).toBe(502);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(setCookies(res)).toEqual([]);
      expect(await consoleSessionsOf(subjectId)).toHaveLength(1);
      expect((await browse(stack, jar, '/console/api/session')).statusCode).toBe(200);
    });
  }, 30_000);

  it('answers a logout whose JSON body is empty as a client error, not a server one', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);

      const res = await logout(stack, jar, { ...WRITE, 'content-type': 'application/json' });

      expect(res.statusCode).toBe(400);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(res.json()).toMatchObject({ status: 400, type: 'about:blank' });
      expect(setCookies(res)).toEqual([]);
      expect(await consoleSessionsOf(subjectId)).toHaveLength(1);
      expect((await browse(stack, jar, '/console/api/session')).statusCode).toBe(200);
    });
  });

  it('answers a logout with no session by sending the browser to the console', async () => {
    await withStack(async (stack) => {
      const res = await logout(stack, new Jar());

      expect(redirectOf(res)).toBe('/console/');
      expectSessionCookieCleared(res);
    });
  });

  // Resolving the cookie is what found the session over, and that is where
  // its grant was revoked; the logout itself has nothing left to present.
  it('answers a logout of an idled-out session as one with none, its grant already ended', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const { refreshToken } = await onlySession(subjectId);

      stack.clock.advance(30 * 60_000 + 1000);
      const res = await logout(stack, jar);

      expect(redirectOf(res)).toBe('/console/');
      expectSessionCookieCleared(res);
      expect(await consoleSessionsOf(subjectId)).toHaveLength(0);
      expect(await refreshAtOp(stack, refreshToken)).toBe('invalid_grant');
    });
  });

  it('answers a second logout with the same cookie the same way as one with none', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const cookie = jar.cookies.get(SESSION_COOKIE) ?? '';
      redirectOf(await logout(stack, jar));

      jar.cookies.set(SESSION_COOKIE, cookie);
      const again = await logout(stack, jar);

      expect(redirectOf(again)).toBe('/console/');
      expectSessionCookieCleared(again);
    });
  });
});
