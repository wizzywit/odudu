import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { makeBff, ORIGIN, request, signIn, START, type Clock } from '#/testing/harness';
import { startUpstream, type FakeUpstream, type Responder } from '#/testing/upstream';
import type { Bff, BffOptions } from '#/types';

let fake: FakeServer;
let upstream: FakeUpstream;
let clock: Clock;
const opened: FakeUpstream[] = [];
beforeEach(async () => {
  fake = await startFakeServer();
  upstream = await startUpstream();
  opened.push(upstream);
  clock = { now: START };
});
afterEach(async () => {
  await fake.close();
  await Promise.all(opened.splice(0).map((server) => server.close()));
});

const AUDIENCE = 'https://api.example/';
const proxied = (overrides: Partial<BffOptions> = {}): Bff =>
  makeBff(fake, clock, {
    upstreams: [{ name: 'api', origin: upstream.origin, pathPrefixes: ['/v1'] }],
    ...overrides,
  });

const GUARD = { 'x-odudu-bff': '1', origin: ORIGIN };
const call = (
  bff: Bff,
  cookie: string | undefined,
  path: string,
  init: RequestInit = {},
): Promise<Response> =>
  bff.proxy(
    request(`/proxy/api${path}`, cookie, {
      ...init,
      headers: { ...GUARD, ...(init.headers as Record<string, string> | undefined) },
    }),
  );

async function signedIn(
  overrides: Partial<BffOptions> = {},
): Promise<{ bff: Bff; cookie: string }> {
  const bff = proxied(overrides);
  return { bff, cookie: (await signIn(bff, fake)).cookie };
}

describe('the allowlist', () => {
  it('an empty allowlist proxies nothing', async () => {
    for (const upstreams of [undefined, []]) {
      const bff = makeBff(fake, clock, upstreams === undefined ? {} : { upstreams });
      const { cookie } = await signIn(bff, fake);
      const response = await call(bff, cookie, '/v1/items');
      expect(response.status).toBe(404);
    }
    expect(upstream.started).toBe(0);
  });

  it('answers 404 for an upstream nobody configured', async () => {
    const { bff, cookie } = await signedIn();
    const response = await bff.proxy(request('/proxy/other/v1/items', cookie, { headers: GUARD }));
    expect(response.status).toBe(404);
    expect(upstream.started).toBe(0);
  });

  it('a path outside the prefix is 403', async () => {
    const { bff, cookie } = await signedIn();
    for (const path of ['/admin', '/v1x', '/', '']) {
      expect((await call(bff, cookie, path)).status).toBe(403);
    }
    expect(upstream.started).toBe(0);
  });

  it.each([
    '/v1/%2e%2e/admin',
    '/v1/%2E%2E/admin',
    '/v1/../admin',
    '/v1/..%2fadmin',
    '/v1%2f..%2fadmin',
    '/v1/a%5cb',
    '/v1\\..\\admin',
    '/v1//admin',
    '/v1/%252e%252e/admin',
    '/v1/a%00b',
    '/v1;x/../admin',
  ])('refuses %s without reaching the upstream', async (path) => {
    const { bff, cookie } = await signedIn();
    expect((await call(bff, cookie, path)).status).toBe(403);
    expect(upstream.started).toBe(0);
  });

  it('answers 405 to a method the upstream does not allow, and to one outside the default list', async () => {
    const { bff, cookie } = await signedIn({
      upstreams: [
        { name: 'api', origin: upstream.origin, pathPrefixes: ['/v1'] },
        { name: 'ro', origin: upstream.origin, pathPrefixes: ['/v1'], methods: ['GET'] },
      ],
    });
    const options = await call(bff, cookie, '/v1/x', { method: 'OPTIONS' });
    expect(options.status).toBe(405);
    expect(options.headers.get('allow')).toBe('GET, POST, PUT, PATCH, DELETE');
    const put = await bff.proxy(
      request('/proxy/ro/v1/x', cookie, { method: 'PUT', headers: GUARD }),
    );
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('GET');
    expect(upstream.started).toBe(0);
  });

  it('answers 404 for the mount path itself and for a path outside it', async () => {
    const { bff, cookie } = await signedIn();
    for (const path of ['/proxy', '/proxy/', '/elsewhere/api/v1']) {
      expect((await bff.proxy(request(path, cookie, { headers: GUARD }))).status).toBe(404);
    }
  });

  it('mounts at proxyPath', async () => {
    const { bff, cookie } = await signedIn({ proxyPath: '/gateway' });
    expect(bff.proxyPath).toBe('/gateway');
    const response = await bff.proxy(request('/gateway/api/v1/x', cookie, { headers: GUARD }));
    expect(response.status).toBe(200);
    expect(upstream.seen[0]?.url).toBe('/v1/x');
  });
});

describe('who may call', () => {
  it('answers 401 and sends nothing upstream without a session', async () => {
    const { bff } = await signedIn();
    for (const cookie of [undefined, '__Host-odudu=nope', `__Host-odudu=${'A'.repeat(43)}`]) {
      const response = await call(bff, cookie, '/v1/x');
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ authenticated: false });
    }
    expect(upstream.started).toBe(0);
  });

  it('answers 403 to a GET without the X-Odudu-BFF header', async () => {
    const { bff, cookie } = await signedIn();
    const response = await bff.proxy(
      request('/proxy/api/v1/x', cookie, { headers: { origin: ORIGIN } }),
    );
    expect(response.status).toBe(403);
    expect(upstream.started).toBe(0);
  });

  it('answers 403 to a GET from another origin and accepts one with no Origin', async () => {
    const { bff, cookie } = await signedIn();
    const foreign = await call(bff, cookie, '/v1/x', {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    const bare = await bff.proxy(
      request('/proxy/api/v1/x', cookie, { headers: { 'x-odudu-bff': '1' } }),
    );
    expect(bare.status).toBe(200);
    expect(upstream.started).toBe(1);
  });

  it('answers 403 to a POST with no Origin', async () => {
    const { bff, cookie } = await signedIn();
    const response = await bff.proxy(
      request('/proxy/api/v1/x', cookie, { method: 'POST', headers: { 'x-odudu-bff': '1' } }),
    );
    expect(response.status).toBe(403);
    expect(upstream.started).toBe(0);
  });
});

describe('what goes upstream', () => {
  it('the cookie and hop-by-hop headers are stripped from the upstream request', async () => {
    const { bff, cookie } = await signedIn();
    await call(bff, `${cookie}; other=1`, '/v1/x?a=1&b=%2F', {
      headers: {
        connection: 'x-secret',
        'keep-alive': 'timeout=5',
        'proxy-authorization': 'Basic eA==',
        te: 'trailers',
        upgrade: 'websocket',
        'x-secret': 'named by connection',
        authorization: 'Bearer forged',
        accept: 'application/json',
        'x-keep': 'yes',
      },
    });
    const seen = upstream.seen[0];
    expect(seen?.url).toBe('/v1/x?a=1&b=%2F');
    expect(seen?.headers.cookie).toBeUndefined();
    expect(seen?.headers.origin).toBeUndefined();
    expect(seen?.headers['x-odudu-bff']).toBeUndefined();
    expect(seen?.headers['proxy-authorization']).toBeUndefined();
    expect(seen?.headers['keep-alive']).toBeUndefined();
    expect(seen?.headers.te).toBeUndefined();
    expect(seen?.headers.upgrade).toBeUndefined();
    expect(seen?.headers['x-secret']).toBeUndefined();
    expect(seen?.headers.connection ?? '').not.toContain('x-secret');
    expect(seen?.headers.host).toBe(new URL(upstream.origin).host);
    expect(seen?.headers.authorization).toBe('Bearer access-token-1');
    expect(seen?.headers['x-keep']).toBe('yes');
    expect(seen?.headers.accept).toBe('application/json');
  });

  it('strips the headers a client could use to spoof its address', async () => {
    const { bff, cookie } = await signedIn();
    await call(bff, cookie, '/v1/x', {
      headers: {
        'x-forwarded-for': '6.6.6.6',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        forwarded: 'for=6.6.6.6',
        'x-real-ip': '6.6.6.6',
        'proxy-connection': 'keep-alive',
        'x-keep': 'yes',
      },
    });
    const headers = upstream.seen[0]?.headers ?? {};
    for (const name of [
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'forwarded',
      'x-real-ip',
      'proxy-connection',
    ]) {
      expect(headers[name]).toBeUndefined();
    }
    expect(headers['x-keep']).toBe('yes');
  });

  it('calls the upstream through the fetch it was given', async () => {
    const urls: string[] = [];
    const bff = proxied({
      deps: {
        allowInsecureRequests: true,
        now: () => clock.now,
        fetch: (input, init) => {
          urls.push(input instanceof Request ? input.url : String(input));
          return fetch(input, init);
        },
      },
    });
    const { cookie } = await signIn(bff, fake);
    await call(bff, cookie, '/v1/x');
    expect(urls).toContain(`${upstream.origin}/v1/x`);
  });

  it('ends the session as a refused refresh does when the tokens expired with no refresh token', async () => {
    fake.issueRefreshToken = false;
    const { bff, cookie } = await signedIn();
    clock.now += 900_000;
    const response = await call(bff, cookie, '/v1/x');
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join(' ')).toContain('__Host-odudu=;');
    expect(upstream.started).toBe(0);
  });

  it('streams a request body through unchanged', async () => {
    const { bff, cookie } = await signedIn();
    const response = await call(bff, cookie, '/v1/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"a"}',
    });
    expect(response.status).toBe(200);
    expect(upstream.seen[0]).toMatchObject({ method: 'POST' });
    expect(upstream.seen[0]?.body.toString()).toBe('{"name":"a"}');
    expect(upstream.seen[0]?.headers['content-type']).toBe('application/json');
  });

  it('the access token is attached and refreshed once on expiry', async () => {
    const { bff, cookie } = await signedIn();
    fake.refreshDelayMs = 30;
    clock.now += 900_000;
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => call(bff, cookie, '/v1/items')));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const refreshes = fake.tokenRequests.filter(
      (form) => form.get('grant_type') === 'refresh_token',
    );
    expect(refreshes).toHaveLength(1);
    const authorizations = upstream.seen.map((seen) => seen.headers.authorization);
    expect(authorizations).toEqual(Array<string>(5).fill('Bearer access-token-2'));
    await call(bff, cookie, '/v1/items');
    expect(fake.tokenRequests).toHaveLength(2);
  });

  it('answers 401, deletes the session and clears the cookie when the refresh is refused', async () => {
    const { bff, cookie } = await signedIn();
    clock.now += 900_000;
    fake.tokenError = { error: 'invalid_grant' };
    const response = await call(bff, cookie, '/v1/items');
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join(' ')).toContain('__Host-odudu=;');
    expect(upstream.started).toBe(0);
    fake.tokenError = undefined;
    const again = await call(bff, cookie, '/v1/items');
    expect(again.status).toBe(401);
    expect(
      await (
        await bff.session(request('/auth/session', cookie, { headers: { 'x-odudu-bff': '1' } }))
      ).json(),
    ).toEqual({
      authenticated: false,
    });
  });

  it('keeps the session and answers 503 when the refresh fails for another reason', async () => {
    const { bff, cookie } = await signedIn();
    clock.now += 900_000;
    fake.tokenError = { error: 'invalid_client' };
    const failed = await call(bff, cookie, '/v1/items');
    expect(failed.status).toBe(503);
    fake.tokenError = undefined;
    expect((await call(bff, cookie, '/v1/items')).status).toBe(200);
  });

  it('attaches the token of the audience an upstream names, and refuses one not granted', async () => {
    const bff = proxied({
      resource: [AUDIENCE],
      upstreams: [
        { name: 'api', origin: upstream.origin, pathPrefixes: ['/v1'], resource: AUDIENCE },
        { name: 'other', origin: upstream.origin, pathPrefixes: ['/v1'], resource: 'https://x/' },
      ],
    });
    const { cookie } = await signIn(bff, fake);
    expect((await call(bff, cookie, '/v1/a')).status).toBe(200);
    expect(upstream.seen[0]?.headers.authorization).toBe('Bearer access-token-1');
    const refused = await bff.proxy(request('/proxy/other/v1/a', cookie, { headers: GUARD }));
    expect(refused.status).toBe(502);
    expect(upstream.started).toBe(1);
  });
});

describe('what comes back', () => {
  async function withUpstream(
    responder: Responder,
    overrides: Partial<BffOptions> = {},
  ): Promise<{ bff: Bff; cookie: string; server: FakeUpstream }> {
    const server = await startUpstream(responder);
    opened.push(server);
    const bff = makeBff(fake, clock, {
      upstreams: [{ name: 'api', origin: server.origin, pathPrefixes: ['/v1'] }],
      ...overrides,
    });
    return { bff, cookie: (await signIn(bff, fake)).cookie, server };
  }

  it('an upstream 302 is returned as is and never followed', async () => {
    const { bff, cookie, server } = await withUpstream((_request, response) => {
      response.writeHead(302, { location: '/v1/followed', 'x-upstream': 'redirect' });
      response.end();
    });
    const response = await call(bff, cookie, '/v1/start');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/v1/followed');
    expect(response.headers.get('x-upstream')).toBe('redirect');
    expect(server.seen.map((seen) => seen.url)).toEqual(['/v1/start']);
  });

  it('returns an upstream 401 as is without retrying', async () => {
    const { bff, cookie, server } = await withUpstream((_request, response) => {
      response.writeHead(401, { 'www-authenticate': 'Bearer error="invalid_token"' });
      response.end('nope');
    });
    const response = await call(bff, cookie, '/v1/x');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expect(await response.text()).toBe('nope');
    expect(server.seen).toHaveLength(1);
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it('never lets an upstream cookie reach the browser, and passes the other headers', async () => {
    const { bff, cookie } = await withUpstream((_request, response) => {
      response.writeHead(200, [
        ['set-cookie', 'a=1; Path=/'],
        ['set-cookie', '__Host-odudu=evil; Path=/'],
        ['x-upstream', 'yes'],
        ['content-type', 'text/plain'],
      ]);
      response.end('hi');
    });
    const response = await call(bff, cookie, '/v1/x');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get('x-upstream')).toBe('yes');
    expect(await response.text()).toBe('hi');
  });

  it('hands over the decoded body of a compressed response without its encoding header', async () => {
    const { bff, cookie } = await withUpstream((_request, response) => {
      const body = gzipSync('hello');
      response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length });
      response.end(body);
    });
    const response = await call(bff, cookie, '/v1/x');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe('hello');
  });

  it('never puts the access token in a header or a body it makes itself', async () => {
    const { bff, cookie } = await signedIn();
    const responses = [
      await call(bff, cookie, '/v1/x'),
      await call(bff, cookie, '/admin'),
      await call(bff, undefined, '/v1/x'),
      await bff.proxy(request('/proxy/api/v1/x', cookie)),
    ];
    for (const response of responses) {
      const everything = `${[...response.headers.entries()].join(' ')} ${await response.text()}`;
      expect(everything).not.toMatch(/access-token|refresh-token|Bearer/u);
    }
  });

  it('answers 504 when the upstream does not answer in time', async () => {
    const { bff, cookie } = await withUpstream(() => undefined, { upstreamTimeoutMs: 100 });
    const started = Date.now();
    const response = await call(bff, cookie, '/v1/x');
    expect(response.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('answers 502 when the upstream cannot be reached', async () => {
    const { bff, cookie, server } = await withUpstream(() => undefined);
    await server.close();
    opened.pop();
    const response = await call(bff, cookie, '/v1/x');
    expect(response.status).toBe(502);
  });
});

describe('body limits', () => {
  it('a body over 10 MiB is refused with 413', async () => {
    const { bff, cookie } = await signedIn();
    const response = await call(bff, cookie, '/v1/upload', {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
      body: new Uint8Array(10 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(upstream.started).toBe(0);
    const exact = await call(bff, cookie, '/v1/upload', {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024) },
      body: new Uint8Array(10 * 1024 * 1024),
    });
    expect(exact.status).toBe(200);
  });

  it('refuses a streamed body that outgrows the limit, sending no more than the limit upstream', async () => {
    const { bff, cookie } = await signedIn({ maxBodyBytes: 1024 });
    const chunk = new Uint8Array(512);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent === 20) controller.close();
      },
    });
    const response = await bff.proxy(
      new Request(`${ORIGIN}/proxy/api/v1/upload`, {
        method: 'POST',
        headers: { ...GUARD, cookie },
        body,
        duplex: 'half',
      }),
    );
    expect(response.status).toBe(413);
    expect(upstream.bytesReceived).toBeLessThanOrEqual(1024);
    expect(sent).toBeLessThan(20);
  });

  it('aborts a response that outgrows the limit instead of buffering it', async () => {
    let written = 0;
    const server = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      const timer = setInterval(() => {
        written += 512;
        response.write(Buffer.alloc(512));
      }, 2);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    opened.push(server);
    const bff = makeBff(fake, clock, {
      upstreams: [{ name: 'api', origin: server.origin, pathPrefixes: ['/v1'] }],
      maxBodyBytes: 2048,
    });
    const { cookie } = await signIn(bff, fake);
    const response = await call(bff, cookie, '/v1/stream');
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
    expect(received).toBeLessThanOrEqual(2048);
    const mark = written;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(written - mark).toBeLessThan(512 * 10);
  });

  it('refuses at once a response that declares more than the limit', async () => {
    const server = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-length': 100_000 });
      response.end(Buffer.alloc(100_000));
    });
    opened.push(server);
    const bff = makeBff(fake, clock, {
      upstreams: [{ name: 'api', origin: server.origin, pathPrefixes: ['/v1'] }],
      maxBodyBytes: 2048,
    });
    const { cookie } = await signIn(bff, fake);
    expect((await call(bff, cookie, '/v1/big')).status).toBe(502);
  });
});

describe('[RFC10017-6.1.3.3.2-01] the custom header on every request', () => {
  it('is required of a proxied GET, and a request without it never leaves the BFF', async () => {
    const { bff, cookie } = await signedIn();
    const response = await bff.proxy(
      request('/proxy/api/v1/x', cookie, { headers: { origin: ORIGIN } }),
    );
    expect(response.status).toBe(403);
    expect(upstream.started).toBe(0);
  });
});

describe('[RFC10017-6.1.3.6-01] outbound request controls', () => {
  it('only an origin named in the configuration is ever called', async () => {
    const { bff, cookie } = await signedIn();
    const statuses: number[] = [];
    for (const path of ['/v1/@evil.example/x', '/v1/..//evil.example', '//evil.example/v1']) {
      statuses.push((await call(bff, cookie, path)).status);
    }
    expect(statuses).toEqual([200, 403, 403]);
    expect(upstream.seen.map((seen) => seen.url)).toEqual(['/v1/@evil.example/x']);
    expect(upstream.seen[0]?.headers.host).toBe(new URL(upstream.origin).host);
  });
});

describe('[RFC10017-6.1.3.6-02] strict validation of path routing', () => {
  it('refuses every way of leaving an allowed prefix', async () => {
    const { bff, cookie } = await signedIn();
    expect((await call(bff, cookie, '/v1/..%2fadmin')).status).toBe(403);
    expect((await call(bff, cookie, '/admin')).status).toBe(403);
    expect(upstream.started).toBe(0);
  });
});

describe('[RFC10017-6.1.3.6-03] a configurable proxy allows only permitted hosts and paths', () => {
  it('proxies nothing without an allowlist', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    expect((await call(bff, cookie, '/v1/x')).status).toBe(404);
  });
});
