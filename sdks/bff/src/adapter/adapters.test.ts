import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bffRouter } from '#/adapter/express';
import { registerBff } from '#/adapter/fastify';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { makeBff, ORIGIN, signIn, START, type Clock } from '#/testing/harness';
import { startUpstream, type FakeUpstream } from '#/testing/upstream';
import type { Bff, BffOptions } from '#/types';

interface Running {
  base: string;
  close: () => Promise<void>;
}

let fake: FakeServer;
let upstream: FakeUpstream;
let clock: Clock;
const running: Running[] = [];
beforeEach(async () => {
  fake = await startFakeServer();
  upstream = await startUpstream((_request, response, seen) => {
    if (seen.url.startsWith('/v1/stream')) {
      response.writeHead(200);
      const timer = setInterval(() => response.write(Buffer.alloc(512)), 2);
      response.on('close', () => {
        clearInterval(timer);
      });
      return;
    }
    response.writeHead(200, [
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
      ['x-upstream', 'yes'],
    ]);
    response.end(seen.body);
  });
  clock = { now: START };
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await upstream.close();
  await fake.close();
});

const bffOf = (overrides: Partial<BffOptions> = {}): Bff =>
  makeBff(fake, clock, {
    upstreams: [{ name: 'api', origin: upstream.origin, pathPrefixes: ['/v1'] }],
    ...overrides,
  });

async function fastifyApp(bff: Bff, prefix: string | null = '/auth'): Promise<Running> {
  const app = Fastify();
  registerBff(app, bff, prefix === null ? {} : { prefix });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${String(port)}`, close: () => app.close() };
}

async function expressApp(bff: Bff, prefix: string | null = '/auth'): Promise<Running> {
  const app = express();
  app.use(bffRouter(bff, prefix === null ? {} : { prefix }));
  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

const frameworks: [string, (bff: Bff, prefix?: string | null) => Promise<Running>][] = [
  ['fastify', fastifyApp],
  ['express', expressApp],
];

describe.each(frameworks)('the %s adapter', (_name, start) => {
  async function serve(overrides: Partial<BffOptions> = {}): Promise<{ base: string; bff: Bff }> {
    const bff = bffOf(overrides);
    const app = await start(bff);
    running.push(app);
    return { base: app.base, bff };
  }
  const guard = { 'x-odudu-bff': '1', origin: ORIGIN };

  it('mounts every route under the BFF mountPath, the proxy included, with no prefix given', async () => {
    const bff = bffOf({ mountPath: '/bff' });
    const app = await start(bff, null);
    running.push(app);
    expect(bff.proxyPath).toBe('/bff/proxy');
    expect((await fetch(`${app.base}/bff/login`, { redirect: 'manual' })).status).toBe(302);
    const session = await fetch(`${app.base}/bff/session`, { headers: guard });
    expect(session.status).toBe(200);
    const proxied = await fetch(`${app.base}/bff/proxy/api/v1/x`, { headers: guard });
    expect(proxied.status).toBe(401);
    expect((await fetch(`${app.base}/proxy/api/v1/x`, { headers: guard })).status).toBe(404);
  });

  it('lets an explicit prefix win over the mountPath', async () => {
    const bff = bffOf({ mountPath: '/bff' });
    const app = await start(bff, '/other');
    running.push(app);
    expect((await fetch(`${app.base}/other/login`, { redirect: 'manual' })).status).toBe(302);
    expect((await fetch(`${app.base}/bff/login`, { redirect: 'manual' })).status).toBe(404);
  });

  it('serves login and session', async () => {
    const { base } = await serve();
    const login = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toContain(`${fake.issuer}/authorize`);
    expect(login.headers.getSetCookie()[0]).toMatch(/^__Host-odudu-login=/u);
    expect((await fetch(`${base}/auth/session`)).status).toBe(403);
    const session = await fetch(`${base}/auth/session`, { headers: guard });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: false });
    expect(session.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 405 through the handler to a method the route does not take', async () => {
    const { base } = await serve();
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: guard });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('sends every Set-Cookie of a response, not only the first', async () => {
    const { base } = await serve();
    const login = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.claims = { nonce: authorize.searchParams.get('nonce') };
    const params = new URLSearchParams({
      code: 'code-1',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const loginCookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
    const callback = await fetch(`${base}/auth/callback?${params.toString()}`, {
      redirect: 'manual',
      headers: { cookie: loginCookie },
    });
    expect(callback.status).toBe(302);
    const cookies = callback.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some((line) => line.startsWith('__Host-odudu='))).toBe(true);
    expect(cookies.some((line) => line.startsWith('__Host-odudu-login=;'))).toBe(true);
  });

  it('logs out through POST', async () => {
    const { base, bff } = await serve();
    const { cookie } = await signIn(bff, fake);
    const response = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { ...guard, cookie },
    });
    expect(response.status).toBe(200);
    const { redirectTo } = (await response.json()) as { redirectTo: string };
    expect(redirectTo).toContain('/logout');
  });

  it('proxies a streamed request body and drops the upstream cookies', async () => {
    const { base, bff } = await serve();
    const { cookie } = await signIn(bff, fake);
    const response = await fetch(`${base}/proxy/api/v1/echo?x=1`, {
      method: 'POST',
      headers: { ...guard, cookie, 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get('x-upstream')).toBe('yes');
    expect(await response.text()).toBe('{"a":1}');
    expect(upstream.seen[0]?.url).toBe('/v1/echo?x=1');
    expect(upstream.seen[0]?.headers.authorization).toBe('Bearer access-token-1');
    expect(upstream.seen[0]?.headers.cookie).toBeUndefined();
  });

  it('proxies a body of a content type a framework would otherwise parse', async () => {
    const { base, bff } = await serve();
    const { cookie } = await signIn(bff, fake);
    for (const type of ['application/x-www-form-urlencoded', 'text/plain']) {
      const response = await fetch(`${base}/proxy/api/v1/echo`, {
        method: 'PUT',
        headers: { ...guard, cookie, 'content-type': type },
        body: 'a=1&b=2',
      });
      expect(await response.text()).toBe('a=1&b=2');
    }
  });

  it('refuses a proxied call with no session and a GET with no header', async () => {
    const { base, bff } = await serve();
    const { cookie } = await signIn(bff, fake);
    expect((await fetch(`${base}/proxy/api/v1/x`, { headers: guard })).status).toBe(401);
    expect((await fetch(`${base}/proxy/api/v1/x`, { headers: { cookie } })).status).toBe(403);
    expect(upstream.started).toBe(0);
  });

  it('refuses a body over the limit with 413 before the upstream sees it', async () => {
    const { base, bff } = await serve({ maxBodyBytes: 1024 });
    const { cookie } = await signIn(bff, fake);
    const response = await fetch(`${base}/proxy/api/v1/echo`, {
      method: 'POST',
      headers: { ...guard, cookie },
      body: new Uint8Array(2048),
    });
    expect(response.status).toBe(413);
    expect(upstream.started).toBe(0);
  });

  it('aborts the connection to the browser when a response outgrows the limit', async () => {
    const { base, bff } = await serve({ maxBodyBytes: 4096 });
    const { cookie } = await signIn(bff, fake);
    const response = await fetch(`${base}/proxy/api/v1/stream`, { headers: { ...guard, cookie } });
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let received = 0;
    let failure: unknown;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
      }
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(received).toBeLessThanOrEqual(4096);
  });

  it('answers 404 to a path the routes do not name', async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/auth/nothing`)).status).toBe(404);
  });
});

describe('adapter prefix', () => {
  it('is refused at registration when it is not a clean path', () => {
    const bff = bffOf();
    expect(() => {
      registerBff(Fastify(), bff, { prefix: '/auth/' });
    }).toThrow(TypeError);
    expect(() => bffRouter(bff, { prefix: 'auth' })).toThrow(TypeError);
  });
});
