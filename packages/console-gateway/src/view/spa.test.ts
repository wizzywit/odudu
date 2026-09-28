import Fastify, { type FastifyInstance } from 'fastify';
import http from 'node:http';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { spaRoutes } from '#/view/spa';

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'dist');
const CSP =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
});

async function served(consoleDir: string, logs: string[] = []): Promise<FastifyInstance> {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const instance = Fastify({ logger: { level: 'warn', stream: destination } });
  await instance.register(spaRoutes(consoleDir));
  await instance.ready();
  app = instance;
  return instance;
}

// `inject` (light-my-request) resolves the URL it is given through the
// WHATWG `URL` parser before Fastify ever sees it, so a dot segment is
// gone before routing starts — proving nothing about how the route itself
// handles one. A real socket sends the request line exactly as written;
// see docs/phases/p4d.md's "Router and inject" note.
async function listening(instance: FastifyInstance): Promise<number> {
  await instance.listen({ port: 0, host: '127.0.0.1' });
  const address = instance.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  return address.port;
}

interface RawResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

function rawGet(port: number, path: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// The asset route's own 404 is an empty, typeless body (`reply.code(404).send()`);
// Fastify's default (root) 404 for a path outside every registered route
// carries a `content-type: application/json` problem body instead. Only
// the former proves the manifest lookup itself ran and refused the path.
function isAssetRouteNotFound(res: RawResponse): boolean {
  return res.status === 404 && res.headers['content-type'] === undefined && res.body === '';
}

describe('the console shell', () => {
  it('serves index.html under the exact CSP, framing defences and no-store', async () => {
    const server = await served(FIXTURE_DIR);

    const res = await server.inject({ url: '/console/tenants/x' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
  });

  it('serves a hashed asset with its content type and an immutable cache header', async () => {
    const server = await served(FIXTURE_DIR);

    const res = await server.inject({ url: '/console/assets/app-3f2a.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body).toContain("console.log('odudu console shell')");
  });

  it('answers 404 for an asset path with no manifest entry', async () => {
    const server = await served(FIXTURE_DIR);

    const res = await server.inject({ url: '/console/assets/does-not-exist.js' });

    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['a literal ../', '/console/assets/../../etc/passwd'],
    ['an encoded ../', '/console/assets/%2e%2e/%2e%2e/etc/passwd'],
    ['an encoded slash', '/console/assets/..%2f..%2fetc%2fpasswd'],
    ['a backslash', '/console/assets/..\\..\\etc\\passwd'],
  ])('refuses traversal through %s, over a real socket', async (_label, url) => {
    const server = await served(FIXTURE_DIR);
    const port = await listening(server);

    const res = await rawGet(port, url);

    expect(isAssetRouteNotFound(res)).toBe(true);
  });

  it('redirects the bare /console to /console/', async () => {
    const server = await served(FIXTURE_DIR);

    const res = await server.inject({ url: '/console' });

    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('/console/');
  });

  it('warns once naming ODUDU_CONSOLE_DIR and answers 503 when the directory is missing', async () => {
    const logs: string[] = [];
    const missing = join(FIXTURE_DIR, 'does-not-exist');
    const server = await served(missing, logs);

    const res = await server.inject({ url: '/console/tenants/x' });

    expect(res.statusCode).toBe(503);
    expect(logs.some((line) => line.includes('ODUDU_CONSOLE_DIR'))).toBe(true);
  });
});
