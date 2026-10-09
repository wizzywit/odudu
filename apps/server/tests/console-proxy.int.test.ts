import { unwrapSecret } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import { CONSOLE_CLIENT_KEY } from '#/testing/console-key';
import {
  adminAssertion,
  browse,
  type ConsoleAppOptions,
  type ConsoleStack,
  Jar,
  KEK,
  holdSessionLock,
  seedTenantAdmin,
  signIn,
  signInToTenant,
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
const CHANGED = 'about:blank#console-principal-changed';
const SUBJECT = 'x-odudu-console-subject';
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
  process.env.ODUDU_CONSOLE_CLIENT_KEY = CONSOLE_CLIENT_KEY;
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  await seedAdmin({ username: `setup-${newId()}` });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_CONSOLE_CLIENT_KEY;
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
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
      ...(method === 'GET' || method === 'HEAD' ? {} : WRITE),
      ...(jar.subject === undefined ? {} : { [SUBJECT]: jar.subject }),
      ...headers,
      ...jar.header(),
    },
    ...(payload === undefined ? {} : { payload }),
  });
  jar.take(res);
  return res;
}

// `inject` resolves a dot segment through the WHATWG `URL` parser before
// Fastify's router ever sees it (docs/phases/p4d.md, "Router and inject"),
// so a traversal probe sent that way proves nothing about routing. A real
// socket sends the request line exactly as written.
async function socketGet(
  stack: ConsoleStack,
  path: string,
  cookieHeader: string,
): Promise<{ status: number; body: string }> {
  await stack.app.listen({ port: 0, host: '127.0.0.1' });
  const address = stack.app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        path,
        method: 'GET',
        headers: { host: stack.base.host, cookie: cookieHeader },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
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
  it('records the request id the browser sees on the forwarded write’s audit row', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const created = await call(stack, jar, SCOPES, {
        method: 'POST',
        ...json({ name: `audited-${newId().slice(-12)}` }),
      });

      expect(created.statusCode, created.body).toBe(201);
      const { id } = created.json<{ id: string }>();
      const audited = await owner.db.execute<{ request_id: string; ip: string }>(
        sql`SELECT request_id, ip FROM audit_events
             WHERE action = 'scope.create' AND resource_id = ${id}`,
      );
      expect(audited).toEqual([
        { request_id: String(created.headers['x-request-id']), ip: BROWSER_IP },
      ]);
    });
  });

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

  it('round-trips a HEAD with the resource’s ETag and no body', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const created = await call(stack, jar, SCOPES, {
        method: 'POST',
        ...json({ name: `head-${newId().slice(-12)}` }),
      });
      const { id } = created.json<{ id: string }>();
      const read = await call(stack, jar, `${SCOPES}/${id}`);

      const head = await call(stack, jar, `${SCOPES}/${id}`, { method: 'HEAD' });

      expect(head.statusCode).toBe(200);
      expect(head.headers.etag).toBe(read.headers.etag);
      expect(head.headers['content-type']).toBe(read.headers['content-type']);
      expect(head.body).toBe('');
      expect(stack.adminRequests.at(-1)).toMatchObject({
        method: 'HEAD',
        url: `/admin/tenants/${SYSTEM_TENANT_NAME}/scopes/${id}`,
      });
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

  it('refuses the same path over a real socket, with a valid session, forwarding nothing', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const before = stack.adminRequests.length;

      const res = await socketGet(
        stack,
        `/console/api/admin/%2e%2e/tenants/${SYSTEM_TENANT_NAME}/.well-known/openid-configuration`,
        jar.header().cookie ?? '',
      );

      expect(res.status).toBe(404);
      expect(res.body).toContain('about:blank#not-found');
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
            'x-request-id',
          ].sort(),
        );
        expect(seen?.headers['x-request-id']).toBe(res.headers['x-request-id']);
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

  it('gives up on a session lock held past five seconds with 502, keeping the session', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const before = await mustSession(subjectId);
      stack.clock.set(new Date(before.access_expires_at.getTime() - 10_000));
      const forwarded = stack.adminRequests.length;
      const tokens = stack.tokenResponses.length;
      const release = await holdSessionLock(owner, subjectId);

      const res = await call(stack, jar, WHOAMI);
      await release();

      expectProblem(res, 502);
      expect((await mustSession(subjectId)).refresh_token_wrapped).toBe(
        before.refresh_token_wrapped,
      );
      expect(stack.adminRequests).toHaveLength(forwarded);
      expect(stack.tokenResponses).toHaveLength(tokens);
    });
  }, 30_000);

  describe('when the token endpoint misbehaves', () => {
    let tokenEndpoint: 'real' | 'unavailable' | 'garbled' = 'real';
    const misbehave = (app: FastifyInstance): void => {
      app.addHook('onRequest', async (request, reply) => {
        if (tokenEndpoint === 'real') return;
        if (!request.url.endsWith('/protocol/openid-connect/token')) return;
        if (tokenEndpoint === 'unavailable') return reply.code(503).send();
        return reply.code(200).header('content-type', 'application/json').send('{"access_token":');
      });
    };

    it('answers 502 to a failed refresh, keeps the session, and refreshes once it recovers', async () => {
      await withStack(
        async (stack) => {
          const jar = new Jar();
          const { subjectId } = await signIn(stack, jar);
          const before = await mustSession(subjectId);
          stack.clock.set(new Date(before.access_expires_at.getTime() - 10_000));
          const forwarded = stack.adminRequests.length;
          const revocations = await reuseRevocations();

          tokenEndpoint = 'unavailable';
          const failed = await call(stack, jar, WHOAMI);
          tokenEndpoint = 'real';

          expectProblem(failed, 502);
          expect((await mustSession(subjectId)).refresh_token_wrapped).toBe(
            before.refresh_token_wrapped,
          );
          expect(stack.adminRequests).toHaveLength(forwarded);

          const tokens = stack.tokenResponses.length;
          const recovered = await call(stack, jar, WHOAMI);
          expect(recovered.statusCode, recovered.body).toBe(200);
          expect(stack.tokenResponses.length - tokens).toBe(1);
          expect(await reuseRevocations()).toBe(revocations);
        },
        { beforeReady: misbehave },
      );
    });

    it('ends the session on a 200 it cannot read, whose token was already rotated', async () => {
      await withStack(
        async (stack) => {
          const jar = new Jar();
          const { subjectId } = await signIn(stack, jar);
          const before = await mustSession(subjectId);
          stack.clock.set(new Date(before.access_expires_at.getTime() - 10_000));
          const forwarded = stack.adminRequests.length;

          tokenEndpoint = 'garbled';
          const res = await call(stack, jar, WHOAMI);
          tokenEndpoint = 'real';

          expectEnded(res);
          expect(await sessionOf(subjectId)).toBeUndefined();
          expect(stack.adminRequests).toHaveLength(forwarded);
        },
        { beforeReady: misbehave },
      );
    });
  });

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

describe('the principal a tab believes it is', () => {
  async function auditRows(): Promise<number> {
    const rows = await owner.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_events`,
    );
    return rows[0]?.n ?? -1;
  }

  function expectChanged(res: LightMyRequestResponse): void {
    expectProblem(res, 409);
    expect(res.json()).toMatchObject({ type: CHANGED, title: 'Conflict' });
  }

  it('refuses a write that names another subject with 409, forwarding and writing nothing', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const forwarded = stack.adminRequests.length;
      const audited = await auditRows();

      const res = await call(stack, jar, SCOPES, {
        method: 'POST',
        ...json({ name: `stale-${newId().slice(-12)}` }),
        headers: { 'content-type': 'application/json', [SUBJECT]: newId() },
      });

      expectChanged(res);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(stack.adminRequests).toHaveLength(forwarded);
      expect(await auditRows()).toBe(audited);
      expect(await sessionOf(subjectId)).toBeDefined();
    });
  });

  it('refuses a write that names no subject the same way', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      jar.subject = undefined;
      const forwarded = stack.adminRequests.length;

      const res = await call(stack, jar, SCOPES, {
        method: 'POST',
        ...json({ name: `unnamed-${newId().slice(-12)}` }),
      });

      expectChanged(res);
      expect(stack.adminRequests).toHaveLength(forwarded);
    });
  });

  it('refuses a read that names another subject, forwarding nothing', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      const forwarded = stack.adminRequests.length;

      expectChanged(await call(stack, jar, WHOAMI, { headers: { [SUBJECT]: newId() } }));
      expect(stack.adminRequests).toHaveLength(forwarded);
    });
  });

  it('still forwards a read that names no subject', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      jar.subject = undefined;

      expect((await call(stack, jar, WHOAMI)).statusCode).toBe(200);
    });
  });

  it('refuses the old subject once another sign-in in the same browser has replaced it', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const first = await signIn(stack, jar);
      // Another tab of the same browser signs somebody else in: the console
      // cookie is shared, so this tab now carries the new session.
      const other = new Jar();
      const second = await signIn(stack, other);
      expect(second.subjectId).not.toBe(first.subjectId);
      jar.cookies.set(SESSION_COOKIE, other.cookies.get(SESSION_COOKIE) ?? '');
      const forwarded = stack.adminRequests.length;

      const stale = await call(stack, jar, SCOPES, {
        method: 'POST',
        ...json({ name: `replaced-${newId().slice(-12)}` }),
        headers: { 'content-type': 'application/json', [SUBJECT]: first.subjectId },
      });

      expectChanged(stale);
      expect(stack.adminRequests).toHaveLength(forwarded);
      const current = await call(stack, jar, WHOAMI, { headers: { [SUBJECT]: second.subjectId } });
      expect(current.statusCode).toBe(200);
    });
  });

  it('answers an ended session as ended, whatever subject the request names', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);
      stack.clock.advance(31 * 60_000);

      expectEnded(await call(stack, jar, WHOAMI, { headers: { [SUBJECT]: newId() } }));
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
        ...(await adminAssertion(stack)),
      }).toString(),
    });
    expect(res.statusCode, res.body).toBe(200);
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

  it('ends the session on a 401 its own tenant’s whoami confirms, revoking the grant', async () => {
    const revokes: string[] = [];
    const seeRevokes = (app: FastifyInstance): void => {
      app.addHook('preHandler', (request, _reply, done) => {
        const body: unknown = request.body;
        if (
          request.url.endsWith('/protocol/openid-connect/revoke') &&
          typeof body === 'object' &&
          body !== null &&
          'token' in body
        ) {
          revokes.push(typeof body.token === 'string' ? body.token : '');
        }
        done();
      });
    };
    await withStack(
      async (stack) => {
        const jar = new Jar();
        const { subjectId } = await signIn(stack, jar);
        const refreshToken = unwrapSecret(
          (await mustSession(subjectId)).refresh_token_wrapped,
          KEK,
        );
        await revokeGrant(stack, subjectId);
        revokes.length = 0;
        const tokens = stack.tokenResponses.length;
        const forwarded = stack.adminRequests.length;

        const res = await call(stack, jar, SCOPES);

        expectEnded(res);
        expect(String(res.headers['set-cookie'])).toMatch(/^odudu-console=;.*Max-Age=0/u);
        expect(stack.adminRequests.slice(forwarded).map((seen) => seen.url)).toEqual([
          `/admin/tenants/${SYSTEM_TENANT_NAME}/scopes`,
          `/admin/tenants/${SYSTEM_TENANT_NAME}/whoami`,
        ]);
        expect(stack.tokenResponses.length).toBe(tokens);
        expect(await sessionOf(subjectId)).toBeUndefined();
        expect(revokes).toEqual([refreshToken]);
        expectEnded(await browse(stack, jar, '/console/api/session'));
      },
      { beforeReady: seeRevokes },
    );
  });

  it('ends the session once its subject is disabled, before the access token runs out', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      expect((await call(stack, jar, SCOPES)).statusCode).toBe(200);
      await owner.db.execute(sql`UPDATE subjects SET disabled_at = now() WHERE id = ${subjectId}`);

      const res = await call(stack, jar, SCOPES);

      expectEnded(res);
      expect(String(res.headers['set-cookie'])).toMatch(/^odudu-console=;.*Max-Age=0/u);
      expect(await sessionOf(subjectId)).toBeUndefined();
    });
  });

  // Two 401s that say nothing about the token: a tenant that does not exist,
  // and a path whose tenant is not the one the token was issued by.
  it('passes through a system admin’s 401 for a tenant that does not exist, keeping the session', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);

      const res = await call(stack, jar, '/console/api/admin/tenants/no-such-tenant/whoami');

      expect(res.statusCode).toBe(401);
      expect(res.json<{ type?: string }>().type).toBe('about:blank');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await sessionOf(subjectId)).toBeDefined();
      expect((await call(stack, jar, WHOAMI)).statusCode).toBe(200);
    });
  });

  it('passes through a tenant admin’s 401 for another tenant’s path, keeping the session', async () => {
    await withStack(async (stack) => {
      const { tenant, username } = await seedTenantAdmin();
      const jar = new Jar();
      await signInToTenant(stack, jar, tenant, username);
      const own = `/console/api/admin/tenants/${tenant}/whoami`;
      expect((await call(stack, jar, own)).statusCode).toBe(200);

      const res = await call(stack, jar, WHOAMI);

      expect(res.statusCode).toBe(401);
      expect(res.json<{ type?: string }>().type).toBe('about:blank');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await call(stack, jar, own)).statusCode).toBe(200);
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

  it('gives up on an idled-out session whose lock is held past five seconds with 502, keeping it', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      stack.clock.advance(31 * 60_000);
      const release = await holdSessionLock(owner, subjectId);

      const res = await call(stack, jar, WHOAMI);
      await release();

      expectProblem(res, 502);
      expect(await sessionOf(subjectId)).toBeDefined();
      expectEnded(await call(stack, jar, WHOAMI));
      expect(await sessionOf(subjectId)).toBeUndefined();
    });
  }, 30_000);

  it('answers the session-ended problem, deleting the row, at the absolute expiry', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const expiresAt = new Date(stack.clock.now().getTime() + 1000);
      await owner.db.execute(
        sql`UPDATE console_sessions SET expires_at = ${expiresAt.toISOString()}::timestamptz
            WHERE subject_id = ${subjectId}`,
      );
      expect((await call(stack, jar, WHOAMI)).statusCode).toBe(200);
      stack.clock.advance(1000);
      const forwarded = stack.adminRequests.length;

      expectEnded(await call(stack, jar, WHOAMI));
      expect(await sessionOf(subjectId)).toBeUndefined();
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
