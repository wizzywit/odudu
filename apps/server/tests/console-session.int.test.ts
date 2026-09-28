import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { provisionConsole } from '#/cli/console';
import { seedAdmin } from '#/cli/seed';
import {
  browse,
  type ConsoleStack,
  Jar,
  KEK,
  signIn,
  startConsoleApp,
} from '#/testing/console-harness';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'http://console.example.test';
const TLS_BASE = 'https://console.example.test';
const SESSION_COOKIE = 'odudu-console';
const MINUTE = 60_000;
const ENDED = 'about:blank#console-session-ended';

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

async function withStack(base: string, run: (stack: ConsoleStack) => Promise<void>): Promise<void> {
  const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, base);
  try {
    await run(stack);
  } finally {
    await stack.app.close();
  }
}

async function sessionsFor(subjectId: string): Promise<Record<string, unknown>[]> {
  return owner.db.execute(sql`SELECT id FROM console_sessions WHERE subject_id = ${subjectId}`);
}

async function lastSeen(subjectId: string): Promise<string[]> {
  const rows = await owner.db.execute<{ last_seen_at: string }>(
    sql`SELECT last_seen_at::text FROM console_sessions WHERE subject_id = ${subjectId}`,
  );
  return rows.map((row) => row.last_seen_at);
}

function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function expectEnded(res: LightMyRequestResponse, cookieName = SESSION_COOKIE): void {
  expect(res.statusCode).toBe(401);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.json()).toMatchObject({ type: ENDED, status: 401 });
  expect(
    setCookies(res).some((c) => c.startsWith(`${cookieName}=;`) && c.includes('Max-Age=0')),
  ).toBe(true);
}

describe('GET /console/api/session', () => {
  it('answers the tenant, subject and username of the signed-in administrator', async () => {
    await withStack(BASE, async (stack) => {
      const jar = new Jar();
      const { subjectId, username } = await signIn(stack, jar);

      const res = await browse(stack, jar, '/console/api/session');

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toEqual({ tenant: SYSTEM_TENANT_NAME, subject_id: subjectId, username });
    });
  });

  it('answers the session-ended problem to a request with no session cookie', async () => {
    await withStack(BASE, async (stack) => {
      expectEnded(await browse(stack, new Jar(), '/console/api/session'));
    });
  });

  it('ends a session idle for thirty minutes and a second, deleting its row', async () => {
    await withStack(BASE, async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const cookie = jar.cookies.get(SESSION_COOKIE) ?? '';

      stack.clock.advance(30 * MINUTE + 1000);
      const res = await browse(stack, jar, '/console/api/session');

      expectEnded(res);
      expect(await sessionsFor(subjectId)).toHaveLength(0);
      jar.cookies.set(SESSION_COOKIE, cookie);
      expectEnded(await browse(stack, jar, '/console/api/session'));
    });
  });

  it('ends a session at twelve hours however active, deleting its row', async () => {
    await withStack(BASE, async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);

      let elapsed = 0;
      while (elapsed + 25 * MINUTE < 12 * 60 * MINUTE) {
        stack.clock.advance(25 * MINUTE);
        elapsed += 25 * MINUTE;
        expect((await browse(stack, jar, '/console/api/session')).statusCode).toBe(200);
      }
      stack.clock.advance(12 * 60 * MINUTE - elapsed);

      expectEnded(await browse(stack, jar, '/console/api/session'));
      expect(await sessionsFor(subjectId)).toHaveLength(0);
    });
  });

  it('finds nothing through a cookie whose tenant prefix was edited', async () => {
    await withStack(BASE, async (stack) => {
      const other = newId();
      await owner.db.execute(
        sql`INSERT INTO tenants (id, name) VALUES (${other}, ${`edited-${other.slice(-12)}`})`,
      );
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const cookie = jar.cookies.get(SESSION_COOKIE) ?? '';
      const forged = new Jar();
      forged.cookies.set(SESSION_COOKIE, `${other}.${cookie.split('.')[1] ?? ''}`);

      expectEnded(await browse(stack, forged, '/console/api/session'));
      expect(await sessionsFor(subjectId)).toHaveLength(1);
      expect((await browse(stack, jar, '/console/api/session')).statusCode).toBe(200);
    });
  });

  it('takes neither of two session cookies of the same name', async () => {
    await withStack(BASE, async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const cookie = jar.cookies.get(SESSION_COOKIE) ?? '';

      const res = await stack.app.inject({
        url: '/console/api/session',
        headers: {
          host: stack.base.host,
          cookie: `${SESSION_COOKIE}=${cookie}; ${SESSION_COOKIE}=${cookie}`,
        },
      });

      expectEnded(res);
    });
  });
});

describe('the session cookie', () => {
  it('is odudu-console without Secure over plain HTTP', async () => {
    await withStack(BASE, async (stack) => {
      const { response } = await signIn(stack, new Jar());
      const session = setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      expect(session).toMatch(
        /^odudu-console=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/u,
      );
    });
  });

  // The admin client's redirect URI follows the base, so the https run
  // re-provisions it and puts the plain one back afterwards.
  it('is __Host-odudu-console, Secure, under TLS, and is the one read back', async () => {
    const databases = { database: appDb, ownerDatabase: owner };
    onTestFinished(async () => {
      process.env.ODUDU_PUBLIC_BASE_URL = BASE;
      await provisionConsole(databases, BASE);
    });
    process.env.ODUDU_PUBLIC_BASE_URL = TLS_BASE;
    await provisionConsole(databases, TLS_BASE);
    await withStack(TLS_BASE, async (stack) => {
      const jar = new Jar();
      const { response, subjectId } = await signIn(stack, jar);
      const session = setCookies(response).find((c) => c.startsWith('__Host-odudu-console='));
      expect(session).toMatch(
        /^__Host-odudu-console=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Secure$/u,
      );

      const res = await browse(stack, jar, '/console/api/session');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ subject_id: string }>().subject_id).toBe(subjectId);
    });
  });
});

describe('a state-changing request to /console/api/', () => {
  const GOOD = { origin: BASE, 'x-odudu-console': '1' };

  it.each([
    ['no Origin', { 'x-odudu-console': '1' }],
    ['another origin', { ...GOOD, origin: 'http://evil.example' }],
    ['no X-Odudu-Console', { origin: BASE }],
  ])('is refused 403 with %s, and changes nothing', async (_label, headers) => {
    await withStack(BASE, async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      // Past the touch interval, so a request that resolved the session
      // would have moved last_seen_at.
      stack.clock.advance(2 * MINUTE);
      const seen = await lastSeen(subjectId);
      expect(seen).toHaveLength(1);
      const audited = await owner.db.execute(sql`SELECT count(*)::int AS n FROM audit_events`);

      const res = await stack.app.inject({
        method: 'POST',
        url: '/console/api/admin/tenants',
        headers: {
          host: stack.base.host,
          'content-type': 'application/json',
          ...headers,
          ...jar.header(),
        },
        payload: JSON.stringify({ name: `csrf-${newId().slice(-12)}` }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(res.json()).toMatchObject({ type: 'about:blank', title: 'Forbidden', status: 403 });
      expect(await owner.db.execute(sql`SELECT count(*)::int AS n FROM audit_events`)).toEqual(
        audited,
      );
      expect(await lastSeen(subjectId)).toEqual(seen);
    });
  });

  it('is judged before routing: one carrying both headers reaches the not-found answer', async () => {
    await withStack(BASE, async (stack) => {
      const res = await stack.app.inject({
        method: 'POST',
        url: '/console/api/no-such-route',
        headers: { host: stack.base.host, ...GOOD },
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(res.json()).toMatchObject({ type: 'about:blank#not-found', status: 404 });
    });
  });
});

describe('a state-changing request to /console/auth/', () => {
  it.each(['/console/auth/login', '/console/auth/callback', '/console/auth/no-such-step'])(
    'is refused 403 at %s without the headers, and not with them',
    async (url) => {
      await withStack(BASE, async (stack) => {
        const refused = await stack.app.inject({
          method: 'POST',
          url,
          headers: { host: stack.base.host },
        });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toMatchObject({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
        });

        const passed = await stack.app.inject({
          method: 'POST',
          url,
          headers: { host: stack.base.host, origin: BASE, 'x-odudu-console': '1' },
        });
        expect(passed.statusCode).toBe(404);
      });
    },
  );
});
