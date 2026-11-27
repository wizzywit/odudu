import Fastify, { type FastifyInstance } from 'fastify';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProxyRoutes, type ProxyRouteDeps } from '#/view/routes/proxy';

const seen: { signal: AbortSignal | undefined; path: string | undefined; buffered: number } = {
  signal: undefined,
  path: undefined,
  buffered: 0,
};
let upstream: PassThrough | undefined;

vi.mock('#/usecase/forward-stream', () => ({
  forwardAdminStream: (_deps: unknown, call: { signal: AbortSignal; path: string }) => {
    seen.signal = call.signal;
    seen.path = call.path;
    upstream = new PassThrough();
    return Promise.resolve({
      kind: 'streaming',
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: upstream,
    });
  },
}));
vi.mock('#/usecase/forward', () => ({
  forwardAdminCall: () => {
    seen.buffered += 1;
    return Promise.resolve({ kind: 'forwarded', status: 200, headers: {}, body: Buffer.alloc(0) });
  },
}));

const deps = { now: () => new Date(0), tls: false } as unknown as ProxyRouteDeps;
const open: FastifyInstance[] = [];

async function serve(): Promise<number> {
  const app = Fastify();
  app.register(
    (api) => {
      registerProxyRoutes(api, deps);
      return Promise.resolve();
    },
    { prefix: '/console/api' },
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  open.push(app);
  return (app.server.address() as AddressInfo).port;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
  upstream = undefined;
  seen.buffered = 0;
});

const MESSAGES = '/console/api/admin/tenants/acme/assistant/conversations/c1/messages';
const RESUME = '/console/api/admin/tenants/acme/assistant/conversations/c1/resume';

// The headers go out with the first chunk, as they do over a real turn, so
// the upstream writes before the response is awaited.
async function begin(port: number, path: string = MESSAGES) {
  const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST' });
  req.end('{}');
  for (let tick = 0; tick < 100 && upstream === undefined; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  upstream?.write('data: first\n\n');
  const res = await new Promise<IncomingMessage>((resolve) => {
    req.once('response', resolve);
  });
  return { req, res };
}

describe('the streamed admin route', () => {
  it('pipes the response as it is written, not when it is complete', async () => {
    const { req, res } = await begin(await serve());
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(seen.path).toBe('/admin/tenants/acme/assistant/conversations/c1/messages');

    const first = await new Promise<string>((resolve) => {
      res.once('data', (chunk: Buffer) => {
        resolve(chunk.toString());
      });
    });
    expect(first).toBe('data: first\n\n');
    expect(upstream?.writableEnded).toBe(false);
    expect(seen.buffered).toBe(0);
    req.destroy();
  });

  it('streams a resumed turn the same way', async () => {
    const { req, res } = await begin(await serve(), RESUME);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(seen.path).toBe('/admin/tenants/acme/assistant/conversations/c1/resume');
    expect(seen.buffered).toBe(0);
    req.destroy();
  });

  it('aborts the call when the browser closes the connection', async () => {
    const { req } = await begin(await serve());
    expect(seen.signal?.aborted).toBe(false);

    req.destroy();
    for (let tick = 0; tick < 100 && seen.signal?.aborted !== true; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(seen.signal?.aborted).toBe(true);
  });

  it('leaves every other admin path on the buffered route', async () => {
    const port = await serve();
    await new Promise<void>((resolve) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/console/api/admin/tenants/acme/assistant/status',
          method: 'GET',
        },
        (res) => {
          res.resume();
          res.once('end', resolve);
        },
      );
      req.end();
    });
    expect(seen.buffered).toBe(1);
  });
});
