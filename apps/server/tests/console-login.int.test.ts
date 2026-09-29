import { unwrapSecret } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { ADMIN_CLIENT_ID, SYSTEM_TENANT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import {
  beginLogin,
  browse,
  type ConsoleStack,
  holdSessionLock,
  Jar,
  KEK,
  pathOf,
  post,
  refreshAtOp,
  RETURN_TO,
  sha256,
  signIn,
  signInAtOp,
  startConsoleApp,
  storedRefreshToken,
} from '#/testing/console-harness';

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

const BASE_HOST = 'console.example.test';
const BASE = `http://${BASE_HOST}`;
const ISSUER = `${BASE}/tenants/${SYSTEM_TENANT_NAME}`;
const REDIRECT_URI = `${BASE}/console/auth/callback`;
const LOGIN_COOKIE = 'odudu-console-login';
const SESSION_COOKIE = 'odudu-console';
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

function startApp(): Promise<ConsoleStack> {
  return startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
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
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(stack, jar);
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
      await stack.app.close();
    }
  });

  it.each([
    ['an invalid tenant name', 'Not_A_Tenant'],
    ['an unknown tenant', 'no-such-tenant'],
    ['no tenant at all', undefined],
  ])('refuses %s', async (_label, tenant) => {
    const stack = await startApp();
    try {
      const query = tenant === undefined ? '' : `?tenant=${tenant}`;
      const res = await browse(stack, new Jar(), `/console/auth/login${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(REFUSAL);
      expect(res.headers['set-cookie']).toBeUndefined();
    } finally {
      await stack.app.close();
    }
  });
});

describe('GET /console/auth/callback', () => {
  it('signs the administrator in and keeps every secret out of logs and audit', async () => {
    const stack = await startApp();
    const { logs } = stack;
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(stack, jar);
      const login = (await owner.db.execute(
        sql`SELECT verifier_wrapped, nonce FROM console_logins WHERE state_hash = ${sha256(state)}`,
      )) as unknown as { verifier_wrapped: string; nonce: string }[];
      const verifier = unwrapSecret(login[0]?.verifier_wrapped ?? '', KEK);
      const { callback, subjectId, username } = await signInAtOp(stack, jar, authorize);
      const code = new URL(callback).searchParams.get('code') ?? '';

      const res = await browse(stack, jar, pathOf(stack, callback));

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

      const me = await browse(stack, jar, '/console/api/session');
      expect(me.statusCode).toBe(200);
      expect(me.json()).toEqual({ tenant: SYSTEM_TENANT_NAME, subject_id: subjectId, username });

      const audit = (await owner.db.execute(
        sql`SELECT detail::text AS detail FROM audit_events`,
      )) as unknown as { detail: string | null }[];
      const exposed = [
        logs.join('\n'),
        audit.map((row) => row.detail ?? '').join('\n'),
        res.body,
        me.body,
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
      await stack.app.close();
    }
  });

  it('completes against the base issuer whatever Host the browser sends', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(stack, jar, 'evil.example');
      expect(authorize.origin).toBe(BASE);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);
      expect(new URL(callback).searchParams.get('iss')).toBe(ISSUER);

      const res = await browse(stack, jar, pathOf(stack, callback), 'evil.example');

      expect(res.statusCode).toBe(302);
      expect(await sessionsFor(subjectId)).toHaveLength(1);
    } finally {
      await stack.app.close();
    }
  });

  // The ordinary way to switch tenants: a new sign-in from a browser that
  // still holds a console cookie replaces the session that cookie named.
  it('ends the session an existing console cookie names, revoking its grant', async () => {
    const stack = await startApp();
    try {
      const first = new Jar();
      const old = await signIn(stack, first);
      const oldRefreshToken = await storedRefreshToken(owner, old.subjectId);
      const second = new Jar();
      second.cookies.set(SESSION_COOKIE, first.cookies.get(SESSION_COOKIE) ?? '');

      const next = await signIn(stack, second);

      expect(await sessionsFor(old.subjectId)).toHaveLength(0);
      expect(await refreshAtOp(stack, oldRefreshToken)).toBe('invalid_grant');
      expect(await sessionsFor(next.subjectId)).toHaveLength(1);
      const session = await browse(stack, second, '/console/api/session');
      expect(session.json<{ subject_id: string }>().subject_id).toBe(next.subjectId);
    } finally {
      await stack.app.close();
    }
  });

  // The old session ends only once the new one exists: a sign-in that is
  // refused or abandoned leaves the administrator where they were.
  it('keeps the old session when the new sign-in is refused', async () => {
    const stack = await startApp();
    try {
      const first = new Jar();
      const old = await signIn(stack, first);
      const second = new Jar();
      second.cookies.set(SESSION_COOKIE, first.cookies.get(SESSION_COOKIE) ?? '');
      const { authorize, state } = await beginLogin(stack, second);
      await owner.db.execute(
        sql`UPDATE console_logins SET nonce = 'tampered' WHERE state_hash = ${sha256(state)}`,
      );
      const next = await signInAtOp(stack, second, authorize);

      expectRefused(await browse(stack, second, pathOf(stack, next.callback)));

      expect(await sessionsFor(old.subjectId)).toHaveLength(1);
      const session = await browse(stack, first, '/console/api/session');
      expect(session.statusCode).toBe(200);
      expect(session.json<{ subject_id: string }>().subject_id).toBe(old.subjectId);
    } finally {
      await stack.app.close();
    }
  });

  it('keeps the old session when the new sign-in is cancelled at the OP', async () => {
    const stack = await startApp();
    try {
      const first = new Jar();
      const old = await signIn(stack, first);
      const second = new Jar();
      second.cookies.set(SESSION_COOKIE, first.cookies.get(SESSION_COOKIE) ?? '');
      const { state } = await beginLogin(stack, second);
      const query = new URLSearchParams({ error: 'access_denied', state, iss: ISSUER });

      const res = await browse(stack, second, `/console/auth/callback?${query.toString()}`);

      expect(res.headers.location).toBe('/console/?login_error=access_denied');
      expect(String(res.headers['set-cookie'])).not.toMatch(/odudu-console=;/u);
      expect(await sessionsFor(old.subjectId)).toHaveLength(1);
      expect((await browse(stack, first, '/console/api/session')).statusCode).toBe(200);
    } finally {
      await stack.app.close();
    }
  });

  it('admits the new sign-in while the session it replaces is locked past five seconds', async () => {
    const stack = await startApp();
    try {
      const first = new Jar();
      const old = await signIn(stack, first);
      const second = new Jar();
      second.cookies.set(SESSION_COOKIE, first.cookies.get(SESSION_COOKIE) ?? '');
      const { authorize } = await beginLogin(stack, second);
      const next = await signInAtOp(stack, second, authorize);
      const release = await holdSessionLock(owner, old.subjectId);

      const res = await browse(stack, second, pathOf(stack, next.callback));
      await release();

      expect(res.statusCode).toBe(302);
      expect(String(res.headers['set-cookie'])).toMatch(/odudu-console=[^;]/u);
      expect(await sessionsFor(next.subjectId)).toHaveLength(1);
      const session = await browse(stack, second, '/console/api/session');
      expect(session.json<{ subject_id: string }>().subject_id).toBe(next.subjectId);
    } finally {
      await stack.app.close();
    }
  }, 30_000);

  // A trigger that raises for one subject's rows is a database failure
  // confined to the step under test.
  async function failFor(
    subjectId: string,
    event: 'INSERT' | 'DELETE',
  ): Promise<() => Promise<void>> {
    const name = `fail_${event.toLowerCase()}_${subjectId.replaceAll('-', '')}`;
    await owner.db.execute(
      sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF ${event === 'INSERT' ? 'NEW' : 'OLD'}.subject_id = '${subjectId}' THEN
            RAISE EXCEPTION 'injected failure' USING ERRCODE = 'XX001';
          END IF;
          RETURN ${event === 'INSERT' ? 'NEW' : 'OLD'};
        END $$`),
    );
    await owner.db.execute(
      sql.raw(`CREATE TRIGGER ${name} BEFORE ${event} ON console_sessions
        FOR EACH ROW EXECUTE FUNCTION ${name}()`),
    );
    return async () => {
      await owner.db.execute(sql.raw(`DROP TRIGGER ${name} ON console_sessions`));
      await owner.db.execute(sql.raw(`DROP FUNCTION ${name}()`));
    };
  }

  it('keeps the old session, and revokes the new grant, when the new one cannot be written', async () => {
    const stack = await startApp();
    try {
      const first = new Jar();
      const old = await signIn(stack, first);
      const second = new Jar();
      second.cookies.set(SESSION_COOKIE, first.cookies.get(SESSION_COOKIE) ?? '');
      const { authorize } = await beginLogin(stack, second);
      const next = await signInAtOp(stack, second, authorize);
      const restore = await failFor(next.subjectId, 'INSERT');

      const res = await browse(stack, second, pathOf(stack, next.callback));
      await restore();

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(String(res.headers['set-cookie'])).not.toMatch(/odudu-console=[^;]/u);
      expect(await sessionsFor(old.subjectId)).toHaveLength(1);
      expect((await browse(stack, first, '/console/api/session')).statusCode).toBe(200);
      const { refresh_token: newRefresh } = JSON.parse(stack.tokenResponses.at(-1) ?? '{}') as {
        refresh_token: string;
      };
      expect(await refreshAtOp(stack, newRefresh)).toBe('invalid_grant');
    } finally {
      await stack.app.close();
    }
  });

  it('admits the new sign-in however ending the old session fails, logging only the kind', async () => {
    const stack = await startApp();
    try {
      const first = new Jar();
      const old = await signIn(stack, first);
      const second = new Jar();
      second.cookies.set(SESSION_COOKIE, first.cookies.get(SESSION_COOKIE) ?? '');
      const { authorize } = await beginLogin(stack, second);
      const next = await signInAtOp(stack, second, authorize);
      const restore = await failFor(old.subjectId, 'DELETE');

      const res = await browse(stack, second, pathOf(stack, next.callback));
      await restore();

      expect(res.statusCode).toBe(302);
      const session = await browse(stack, second, '/console/api/session');
      expect(session.json<{ subject_id: string }>().subject_id).toBe(next.subjectId);
      const logged = stack.logs.find((line) => line.includes('replaced console session'));
      expect(logged).toBeDefined();
      expect(logged).toContain('XX001');
      expect(logged).not.toContain('injected failure');
      expect(logged).not.toContain(old.subjectId);
    } finally {
      await stack.app.close();
    }
  });

  it('refuses a missing or mismatched login cookie, and still accepts the right one', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(stack, jar);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);

      jar.cookies.delete(LOGIN_COOKIE);
      expectRefused(await browse(stack, jar, pathOf(stack, callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);

      jar.cookies.set(LOGIN_COOKIE, `${SYSTEM_TENANT_ID}.bm90LXRoZS1zdGF0ZQ`);
      expectRefused(await browse(stack, jar, pathOf(stack, callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);

      jar.cookies.set(LOGIN_COOKIE, state);
      expect((await browse(stack, jar, pathOf(stack, callback))).statusCode).toBe(302);
      expect(await sessionsFor(subjectId)).toHaveLength(1);
    } finally {
      await stack.app.close();
    }
  });

  it('refuses a replayed state', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(stack, jar);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);
      expect((await browse(stack, jar, pathOf(stack, callback))).statusCode).toBe(302);

      jar.cookies.set(LOGIN_COOKIE, state);
      expectRefused(await browse(stack, jar, pathOf(stack, callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(1);
    } finally {
      await stack.app.close();
    }
  });

  it('refuses a login that has expired', async () => {
    const stack = await startApp();
    const { clock } = stack;
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(stack, jar);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);
      clock.advance(11 * 60 * 1000);

      expectRefused(await browse(stack, jar, pathOf(stack, callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    } finally {
      await stack.app.close();
    }
  });

  it('refuses an iss naming another tenant', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(stack, jar);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);
      const forged = new URL(callback);
      forged.searchParams.set('iss', `${BASE}/tenants/acme`);

      expectRefused(await browse(stack, jar, pathOf(stack, forged.toString())));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    } finally {
      await stack.app.close();
    }
  });

  it('refuses an ID token whose nonce is not the login’s, and revokes its grant', async () => {
    const stack = await startApp();
    const { tokenResponses } = stack;
    try {
      const jar = new Jar();
      const { authorize, state } = await beginLogin(stack, jar);
      await owner.db.execute(
        sql`UPDATE console_logins SET nonce = 'tampered' WHERE state_hash = ${sha256(state)}`,
      );
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);

      expectRefused(await browse(stack, jar, pathOf(stack, callback)));
      expect(await sessionsFor(subjectId)).toHaveLength(0);

      expect(tokenResponses).toHaveLength(1);
      const { refresh_token: refreshToken } = JSON.parse(tokenResponses[0] ?? '{}') as {
        refresh_token: string;
      };
      const refreshed = await post(
        stack,
        new Jar(),
        `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/token`,
        { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: ADMIN_CLIENT_ID },
      );
      expect(refreshed.statusCode).toBe(400);
      expect(refreshed.json<{ error: string }>().error).toBe('invalid_grant');
    } finally {
      await stack.app.close();
    }
  });

  it('refuses a callback that names no issuer', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { authorize } = await beginLogin(stack, jar);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);
      const stripped = new URL(callback);
      stripped.searchParams.delete('iss');

      expectRefused(await browse(stack, jar, pathOf(stack, stripped.toString())));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    } finally {
      await stack.app.close();
    }
  });

  it('refuses a state and cookie whose tenant prefix was edited, leaving the login', async () => {
    const stack = await startApp();
    try {
      const other = newId();
      await owner.db.execute(
        sql`INSERT INTO tenants (id, name) VALUES (${other}, ${`edited-${other.slice(-12)}`})`,
      );
      const jar = new Jar();
      const { authorize, state } = await beginLogin(stack, jar);
      const { callback, subjectId } = await signInAtOp(stack, jar, authorize);
      const edited = `${other}.${state.split('.')[1] ?? ''}`;
      const forged = new URL(callback);
      forged.searchParams.set('state', edited);
      jar.cookies.set(LOGIN_COOKIE, edited);

      expectRefused(await browse(stack, jar, pathOf(stack, forged.toString())));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
      const left = await owner.db.execute(
        sql`SELECT id FROM console_logins WHERE state_hash = ${sha256(state)}`,
      );
      expect(left).toHaveLength(1);
    } finally {
      await stack.app.close();
    }
  });

  it('turns an error code outside the registered set into server_error', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { state } = await beginLogin(stack, jar);
      const query = new URLSearchParams({ error: 'made_up_code', state, iss: ISSUER });

      const res = await browse(stack, jar, `/console/auth/callback?${query.toString()}`);

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/console/?login_error=server_error');
    } finally {
      await stack.app.close();
    }
  });

  it('passes on only the error code of an OP error response', async () => {
    const stack = await startApp();
    try {
      const jar = new Jar();
      const { state } = await beginLogin(stack, jar);
      const query = new URLSearchParams({
        error: 'access_denied',
        error_description: 'the user said no',
        state,
        iss: ISSUER,
      });

      const res = await browse(stack, jar, `/console/auth/callback?${query.toString()}`);

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/console/?login_error=access_denied');
      expect(jar.cookies.has(LOGIN_COOKIE)).toBe(false);
      const left = await owner.db.execute(
        sql`SELECT id FROM console_logins WHERE state_hash = ${sha256(state)}`,
      );
      expect(left).toHaveLength(0);
    } finally {
      await stack.app.close();
    }
  });
});
