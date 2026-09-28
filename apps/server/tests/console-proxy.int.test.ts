import { unwrapSecret } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import {
  type ConsoleAppOptions,
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
const SESSION_COOKIE = 'odudu-console';
const ENDED = 'about:blank#console-session-ended';
const BROWSER_IP = '203.0.113.9';
// The admin import's own body limit.
const IMPORT_LIMIT = 16 * 1024 * 1024;
const WRITE = { origin: BASE, 'x-odudu-console': '1' };
const SCOPES = `/console/api/admin/tenants/${SYSTEM_TENANT_NAME}/scopes`;
const WHOAMI = `/console/api/admin/tenants/${SYSTEM_TENANT_NAME}/whoami`;

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

async function start(options: ConsoleAppOptions = {}): Promise<ConsoleStack> {
  return startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE, options);
}

async function withStack(
  run: (stack: ConsoleStack) => Promise<void>,
  options: ConsoleAppOptions = {},
): Promise<void> {
  const stack = await start(options);
  try {
    await run(stack);
  } finally {
    await stack.app.close();
  }
}

interface Call {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: Record<string, string>;
  readonly payload?: string | Buffer;
}

async function call(
  stack: ConsoleStack,
  jar: Jar,
  url: string,
  { method = 'GET', headers = {}, payload }: Call = {},
): Promise<LightMyRequestResponse> {
  const res = await stack.app.inject({
    method,
    url,
    remoteAddress: BROWSER_IP,
    headers: {
      host: stack.base.host,
      ...(method === 'GET' ? {} : WRITE),
      ...headers,
      ...jar.header(),
    },
    ...(payload === undefined ? {} : { payload }),
  });
  jar.take(res);
  return res;
}

function json(payload: unknown): Call {
  return { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) };
}

interface SessionRow {
  readonly access_expires_at: Date;
  readonly access_token_wrapped: string;
  readonly refresh_token_wrapped: string;
}

async function sessionOf(subjectId: string): Promise<SessionRow | undefined> {
  const rows = await owner.db.execute<{
    access_expires_at: string;
    access_token_wrapped: string;
    refresh_token_wrapped: string;
  }>(
    sql`SELECT access_expires_at::text, access_token_wrapped, refresh_token_wrapped
        FROM console_sessions WHERE subject_id = ${subjectId}`,
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : { ...row, access_expires_at: new Date(row.access_expires_at) };
}

async function mustSession(subjectId: string): Promise<SessionRow> {
  const row = await sessionOf(subjectId);
  if (row === undefined) throw new Error('no console session');
  return row;
}

async function reuseRevocations(): Promise<number> {
  const rows = await owner.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM audit_events WHERE action = 'grant.revoked_on_reuse'`,
  );
  return rows[0]?.n ?? -1;
}

function expectProblem(res: LightMyRequestResponse, status: number): void {
  expect(res.statusCode, res.body.slice(0, 300)).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
  expect(res.json()).toMatchObject({ status });
}

function expectEnded(res: LightMyRequestResponse): void {
  expectProblem(res, 401);
  expect(res.json()).toMatchObject({ type: ENDED });
}

describe('* /console/api/admin/*', () => {
  it('round-trips a create, a read, a conditional amend and a delete', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const name = `proxied-${newId().slice(-12)}`;

      const created = await call(stack, jar, SCOPES, { method: 'POST', ...json({ name }) });
      expect(created.statusCode, created.body).toBe(201);
      const { id } = created.json<{ id: string }>();
      expect(created.json()).toMatchObject({ name });

      const read = await call(stack, jar, `${SCOPES}/${id}`);
      expect(read.statusCode).toBe(200);
      expect(read.headers['cache-control']).toBe('no-store');
      const etag = String(read.headers.etag);
      expect(etag).toMatch(/^"/u);

      const amend = json({ description: 'amended through the console' });
      const stale = await call(stack, jar, `${SCOPES}/${id}`, {
        ...amend,
        method: 'PATCH',
        headers: { ...amend.headers, 'if-match': '"stale"' },
      });
      expectProblem(stale, 412);

      const amended = await call(stack, jar, `${SCOPES}/${id}`, {
        ...amend,
        method: 'PATCH',
        headers: { ...amend.headers, 'if-match': etag },
      });
      expect(amended.statusCode, amended.body).toBe(200);
      expect(amended.headers.etag).toMatch(/^"/u);
      expect(amended.headers.etag).not.toBe(etag);
      expect(amended.json()).toMatchObject({ description: 'amended through the console' });

      const deleted = await call(stack, jar, `${SCOPES}/${id}`, { method: 'DELETE' });
      expect(deleted.statusCode).toBe(204);
      expect(deleted.body).toBe('');

      const gone = await call(stack, jar, `${SCOPES}/${id}`);
      expectProblem(gone, 404);
      expect(gone.json()).toMatchObject({ type: 'about:blank' });
    });
  });

  it('rewrites a Link next into /console/api/admin/, and the link can be followed', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const first = await call(stack, jar, `${SCOPES}?limit=1`);
      expect(first.statusCode).toBe(200);
      const link = String(first.headers.link);
      const next = /^<([^>]+)>; rel="next"$/u.exec(link)?.[1] ?? '';
      expect(next.startsWith(`${SCOPES}?`)).toBe(true);

      const second = await call(stack, jar, next);
      expect(second.statusCode).toBe(200);
      expect(second.json<{ items: unknown[] }>().items).toHaveLength(1);
      expect(second.json()).not.toEqual(first.json());
    });
  });

  it('forwards to an unknown admin path and passes back the admin API’s own 404', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const res = await call(stack, jar, '/console/api/admin/no-such-thing');

      expect(res.statusCode).toBe(404);
      expect(stack.adminRequests.at(-1)?.url).toBe('/admin/no-such-thing');
    });
  });

  it('refuses a path that would resolve outside /admin/, forwarding nothing', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const before = stack.adminRequests.length;

      const res = await call(
        stack,
        jar,
        `/console/api/admin/%2e%2e/tenants/${SYSTEM_TENANT_NAME}/.well-known/openid-configuration`,
      );

      expectProblem(res, 404);
      expect(stack.adminRequests).toHaveLength(before);
    });
  });
});

// Registered only here: it answers with every header the proxy must filter,
// and echoes the bytes it was sent.
function spy(app: FastifyInstance): void {
  app.register((scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
    scope.route({
      method: ['GET', 'POST'],
      url: '/admin/spy',
      handler: async (request, reply) =>
        reply
          .code(207)
          .header('set-cookie', ['spy=1; Path=/', 'odudu-console=forged; Path=/'])
          .header('x-spy', '1')
          .header('etag', '"spy-1"')
          .header('cache-control', 'private, max-age=5')
          .header('location', '/admin/tenants/system/scopes/abc')
          .header(
            'link',
            '</admin/spy?cursor=a>; rel="next", <https://elsewhere.example/admin/x>; rel="help"',
          )
          .header('content-type', 'application/octet-stream')
          .send(Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0)),
    });
    return Promise.resolve();
  });
}

describe('what the proxy passes on', () => {
  it('sends upstream only its own bearer token and the named headers, never the browser’s cookie or authorization', async () => {
    await withStack(
      async (stack) => {
        const jar = new Jar();
        const { subjectId } = await signIn(stack, jar);
        const body = randomBytes(4096);

        const res = await call(stack, jar, '/console/api/admin/spy?a=1&b=%20x&a=2', {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'if-match': '"m"',
            'if-none-match': '"n"',
            accept: 'application/octet-stream',
            authorization: 'Bearer from-the-browser',
            'x-forwarded-for': '198.51.100.7',
            'x-custom': 'dropped',
          },
          payload: body,
        });

        expect(res.statusCode).toBe(207);
        expect(Buffer.compare(res.rawPayload, body)).toBe(0);

        const seen = stack.adminRequests.at(-1);
        expect(seen?.url).toBe('/admin/spy?a=1&b=%20x&a=2');
        expect(seen?.ip).toBe(BROWSER_IP);
        const session = await mustSession(subjectId);
        expect(seen?.headers.authorization).toBe(
          `Bearer ${unwrapSecret(session.access_token_wrapped, KEK)}`,
        );
        expect(seen?.headers.cookie).toBeUndefined();
        expect(seen?.headers.host).toBe(stack.base.host);
        expect(seen?.headers).toMatchObject({
          'content-type': 'application/octet-stream',
          'if-match': '"m"',
          'if-none-match': '"n"',
          accept: 'application/octet-stream',
        });
        expect(Object.keys(seen?.headers ?? {}).sort()).toEqual(
          [
            'accept',
            'authorization',
            'content-length',
            'content-type',
            'host',
            'if-match',
            'if-none-match',
            'user-agent',
            'x-forwarded-host',
            'x-forwarded-proto',
          ].sort(),
        );
      },
      { beforeReady: spy },
    );
  });

  it('passes back only the named headers, rewritten, and never an upstream Set-Cookie', async () => {
    await withStack(
      async (stack) => {
        const jar = new Jar();
        await signIn(stack, jar);
        const cookie = jar.cookies.get(SESSION_COOKIE);

        const res = await call(stack, jar, '/console/api/admin/spy');

        expect(res.statusCode).toBe(207);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.headers['x-spy']).toBeUndefined();
        expect(res.headers.etag).toBe('"spy-1"');
        expect(res.headers['cache-control']).toBe('private, max-age=5');
        expect(res.headers['content-type']).toBe('application/octet-stream');
        expect(res.headers.location).toBe('/console/api/admin/tenants/system/scopes/abc');
        expect(res.headers.link).toBe(
          '</console/api/admin/spy?cursor=a>; rel="next", <https://elsewhere.example/admin/x>; rel="help"',
        );
        expect(jar.cookies.get(SESSION_COOKIE)).toBe(cookie);
      },
      { beforeReady: spy },
    );
  });

  it('keeps a vendor JSON body byte for byte', async () => {
    await withStack(
      async (stack) => {
        const jar = new Jar();
        await signIn(stack, jar);
        const payload = '{ "b":1,\n  "a" : "\\u00e9" }';

        const res = await call(stack, jar, '/console/api/admin/spy', {
          method: 'POST',
          headers: { 'content-type': 'application/vnd.odudu.tenant+json' },
          payload,
        });

        expect(res.statusCode).toBe(207);
        expect(res.body).toBe(payload);
        expect(stack.adminRequests.at(-1)?.headers['content-type']).toBe(
          'application/vnd.odudu.tenant+json',
        );
      },
      { beforeReady: spy },
    );
  });
});

describe('the body limit', () => {
  function importOf(size: number): string {
    const shell = JSON.stringify({
      name: `import-${newId().slice(-12)}`,
      document: { padding: '' },
    });
    return shell.replace('"padding":""', `"padding":"${'x'.repeat(size - shell.length)}"`);
  }

  it('admits an import of exactly the admin import’s limit and forwards it', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const payload = importOf(IMPORT_LIMIT);
      expect(Buffer.byteLength(payload)).toBe(IMPORT_LIMIT);

      const res = await call(stack, jar, '/console/api/admin/tenant-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        payload,
      });

      expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
      expect(stack.adminRequests.at(-1)?.url).toBe('/admin/tenant-imports');
    });
  });

  it('refuses one byte more with 413, forwarding nothing', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const before = stack.adminRequests.length;

      const res = await call(stack, jar, '/console/api/admin/tenant-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        payload: importOf(IMPORT_LIMIT + 1),
      });

      expectProblem(res, 413);
      expect(stack.adminRequests).toHaveLength(before);
    });
  });
});

describe('the access token', () => {
  it('is refreshed once for two requests racing inside the refresh window', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const before = await mustSession(subjectId);
      stack.clock.set(new Date(before.access_expires_at.getTime() - 10_000));
      const tokens = stack.tokenResponses.length;
      const revocations = await reuseRevocations();

      const [a, b] = await Promise.all([call(stack, jar, WHOAMI), call(stack, jar, WHOAMI)]);

      expect(a.statusCode, a.body).toBe(200);
      expect(b.statusCode, b.body).toBe(200);
      expect(stack.tokenResponses.length - tokens).toBe(1);
      const after = await mustSession(subjectId);
      expect(after.access_expires_at.getTime()).toBeGreaterThan(before.access_expires_at.getTime());
      expect(after.refresh_token_wrapped).not.toBe(before.refresh_token_wrapped);

      expect((await call(stack, jar, WHOAMI)).statusCode).toBe(200);
      expect(await reuseRevocations()).toBe(revocations);
    });
  });

  it('is refreshed once when two server instances race on the same session', async () => {
    const one = await start();
    const two = await start();
    try {
      const jar = new Jar();
      const { subjectId } = await signIn(one, jar);
      const before = await mustSession(subjectId);
      const at = new Date(before.access_expires_at.getTime() - 10_000);
      one.clock.set(at);
      two.clock.set(at);
      const tokens = one.tokenResponses.length + two.tokenResponses.length;
      const revocations = await reuseRevocations();

      const [a, b] = await Promise.all([call(one, jar, WHOAMI), call(two, jar, WHOAMI)]);

      expect(a.statusCode, a.body).toBe(200);
      expect(b.statusCode, b.body).toBe(200);
      expect(one.tokenResponses.length + two.tokenResponses.length - tokens).toBe(1);
      expect((await call(two, jar, WHOAMI)).statusCode).toBe(200);
      expect(await reuseRevocations()).toBe(revocations);
    } finally {
      await one.app.close();
      await two.app.close();
    }
  });

  it('keeps a five-connection pool live under more refreshing sessions than it has connections', async () => {
    // Holds the first refresh inside the token endpoint, with the session's
    // row locked, until the rest of the load has arrived.
    let entered: () => void = () => undefined;
    const refreshing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let armed = false;
    let gated = false;
    const holdFirstRefresh = (app: FastifyInstance): void => {
      app.addHook('onRequest', async (request) => {
        if (!armed || gated || !request.url.endsWith('/protocol/openid-connect/token')) return;
        gated = true;
        entered();
        await gate;
      });
    };

    await withStack(
      async (stack) => {
        const sessions: { jar: Jar; subjectId: string }[] = [];
        for (let i = 0; i < 7; i += 1) {
          const jar = new Jar();
          const { subjectId } = await signIn(stack, jar);
          sessions.push({ jar, subjectId });
        }
        const [burst, ...others] = sessions;
        if (burst === undefined) throw new Error('no session');
        const expiry = (await mustSession(burst.subjectId)).access_expires_at;
        stack.clock.set(new Date(expiry.getTime() - 10_000));
        const tokens = stack.tokenResponses.length;
        armed = true;

        const first = call(stack, burst.jar, WHOAMI);
        await refreshing;
        // Past the touch interval, so each request of the burst touches the
        // row the held refresh has locked.
        stack.clock.advance(61_000);
        const rest = [
          ...Array.from({ length: 6 }, () => call(stack, burst.jar, WHOAMI)),
          ...others.map(({ jar }) => call(stack, jar, WHOAMI)),
        ];
        await new Promise((resolve) => setTimeout(resolve, 300));
        release();
        const responses = await Promise.all([first, ...rest]);

        expect(responses.map((res) => res.statusCode)).toEqual(responses.map(() => 200));
        expect(stack.tokenResponses.length - tokens).toBe(sessions.length);
      },
      { throttle: { limit: 100, windowSeconds: 60 }, beforeReady: holdFirstRefresh },
    );
  }, 30_000);

  it('is not refreshed outside the window', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const before = await mustSession(subjectId);
      stack.clock.set(new Date(before.access_expires_at.getTime() - 31_000));
      const tokens = stack.tokenResponses.length;

      expect((await call(stack, jar, WHOAMI)).statusCode).toBe(200);
      expect(stack.tokenResponses.length).toBe(tokens);
    });
  });
});

describe('an ended session or grant', () => {
  async function revokeGrant(stack: ConsoleStack, subjectId: string): Promise<void> {
    const session = await mustSession(subjectId);
    const res = await stack.app.inject({
      method: 'POST',
      url: `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/revoke`,
      headers: { host: stack.base.host, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        token: unwrapSecret(session.refresh_token_wrapped, KEK),
        token_type_hint: 'refresh_token',
        client_id: 'odudu-admin',
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
  }

  it('ends the session with 401 and deletes its row when the refresh is refused', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      await revokeGrant(stack, subjectId);
      const before = await mustSession(subjectId);
      stack.clock.set(new Date(before.access_expires_at.getTime() - 10_000));
      const forwarded = stack.adminRequests.length;

      const res = await call(stack, jar, WHOAMI);

      expectEnded(res);
      expect(String(res.headers['set-cookie'])).toMatch(/^odudu-console=;.*Max-Age=0/u);
      expect(await sessionOf(subjectId)).toBeUndefined();
      expect(stack.adminRequests).toHaveLength(forwarded);
    });
  });

  it('passes the admin API’s own 401 through outside the window, without refreshing', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      await revokeGrant(stack, subjectId);
      const tokens = stack.tokenResponses.length;

      const res = await call(stack, jar, WHOAMI);

      expect(res.statusCode).toBe(401);
      expect(res.json<{ type?: string }>().type).not.toBe(ENDED);
      expect(stack.tokenResponses.length).toBe(tokens);
      expect(await sessionOf(subjectId)).toBeDefined();
    });
  });

  it('answers the session-ended problem, forwarding nothing, once the session is idle', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      stack.clock.advance(31 * 60_000);
      const forwarded = stack.adminRequests.length;

      expectEnded(await call(stack, jar, WHOAMI));
      expect(stack.adminRequests).toHaveLength(forwarded);
    });
  });

  it('answers the session-ended problem to a request with no session cookie', async () => {
    await withStack(async (stack) => {
      const forwarded = stack.adminRequests.length;

      expectEnded(await call(stack, new Jar(), WHOAMI));
      expect(stack.adminRequests).toHaveLength(forwarded);
    });
  });
});
