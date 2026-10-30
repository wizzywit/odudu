import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { answerNotFound, answerServerError, type UnroutedDeps } from '#/view/routes/unrouted';

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const DEPS: UnroutedDeps = {
  links: { console: 'https://c.example.test/console/', docs: '/docs/' },
};

let app: FastifyInstance | undefined;

function build(deps: UnroutedDeps = DEPS): FastifyInstance {
  const built = Fastify({ genReqId: () => 'req-1', requestIdHeader: 'x-request-id' });
  built.setNotFoundHandler((request, reply) => answerNotFound(request, reply, deps));
  built.setErrorHandler<FastifyError>((error, request, reply) =>
    answerServerError(error, request, reply),
  );
  built.get('/boom', () => {
    throw new Error('select * from secrets where token = $1');
  });
  built.get('/teapot', () => {
    throw Object.assign(new Error('short and stout'), { statusCode: 418 });
  });
  app = built;
  return built;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('an unknown path', () => {
  it('is a branded page, status 404, for a browser navigation', async () => {
    const res = await build().inject({ url: '/nope', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/html/u);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers.vary).toBe('Accept, Accept-Language, Cookie');
    expect(res.body).toContain('<h1>Page not found</h1>');
    expect(res.body).toContain('href="/docs/"');
    expect(res.body).toContain('href="https://c.example.test/console/"');
  });

  it('is a problem document for a program, with the neutral detail', async () => {
    for (const headers of [{}, { accept: 'application/json' }, { accept: '*/*' }]) {
      const res = await build().inject({ url: '/nope', headers });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(res.headers.vary).toBe('Accept');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toEqual({
        type: 'about:blank#not-found',
        title: 'Not Found',
        status: 404,
        detail: 'No resource at this path',
        instance: 'req-1',
      });
      await app?.close();
    }
  });

  // light-my-request keeps the payload a socket would drop, so the length is
  // what shows the HEAD answer describes the page a GET returns; a real socket
  // shows the body is not sent.
  it('answers a HEAD navigation with the headers and length a GET gets, and no body on the wire', async () => {
    const headers = { accept: BROWSER };
    const get = await build().inject({ url: '/nope', headers });
    const head = await app?.inject({ method: 'HEAD', url: '/nope', headers });
    expect(head?.statusCode).toBe(404);
    expect(head?.headers['content-type']).toMatch(/^text\/html/u);
    expect(head?.headers['content-length']).toBe(String(Buffer.byteLength(get.body)));
    expect(head?.headers['cache-control']).toBe('no-store');
    await app?.close();
    const live = build();
    await live.listen({ port: 0, host: '127.0.0.1' });
    const address = live.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const wire = await fetch(`http://127.0.0.1:${String(port)}/nope`, { method: 'HEAD', headers });
    expect(wire.status).toBe(404);
    expect(wire.headers.get('content-length')).toBe(String(Buffer.byteLength(get.body)));
    expect(await wire.text()).toBe('');
  });

  it('keeps the problem document under an API prefix, whatever the browser sends', async () => {
    for (const url of ['/admin/x', '/console/api/x', '/health/x', '/tenants/t/protocol/x']) {
      const res = await build().inject({ url, headers: { accept: BROWSER } });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/^application\/problem\+json/u);
      expect(res.headers.vary, url).toBeUndefined();
      await app?.close();
    }
  });

  it('keeps the problem document for a write, even from a browser', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/nope',
      headers: { accept: BROWSER },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
  });

  it('reflects nothing from the request into the page', async () => {
    const res = await build().inject({
      url: '/<script>alert(1)</script>/zzz-marker?q=qqq-marker',
      headers: { accept: BROWSER, referer: 'https://evil.example/rrr-marker' },
    });
    expect(res.statusCode).toBe(404);
    for (const marker of ['zzz-marker', 'qqq-marker', 'rrr-marker', 'alert(1)']) {
      expect(res.body).not.toContain(marker);
    }
  });

  it('shows the same page for every path, so none says anything about what exists', async () => {
    const a = await build().inject({
      url: '/tenants/exists/login-actions/nope',
      headers: { accept: BROWSER },
    });
    const b = await app?.inject({
      url: '/tenants/missing/login-actions/nope',
      headers: { accept: BROWSER },
    });
    expect(b?.statusCode).toBe(a.statusCode);
    expect(b?.body).toBe(a.body);
  });

  it('is written in the language the browser asks for', async () => {
    const res = await build().inject({
      url: '/nope',
      headers: { accept: BROWSER, 'accept-language': 'en-GB,en;q=0.9' },
    });
    expect(res.headers['content-language']).toBe('en');
    expect(res.body).toContain('<html lang="en" dir="ltr">');
  });

  it('offers no link for a destination this deployment lacks', async () => {
    const res = await build({ links: {} }).inject({ url: '/nope', headers: { accept: BROWSER } });
    expect(res.body).not.toContain('<a ');
  });
});

describe('an unhandled error', () => {
  it('is a fixed page with the request id for a browser, and never the message', async () => {
    const res = await build().inject({ url: '/boom', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^text\/html/u);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.vary).toBe('Accept, Accept-Language, Cookie');
    expect(res.body).toContain('Something went wrong');
    expect(res.body).toContain('req-1');
    for (const leaked of ['select', 'secrets', 'token', 'Error:', 'at ']) {
      expect(res.body).not.toContain(leaked);
    }
  });

  it('is the problem document for a program', async () => {
    const res = await build().inject({ url: '/boom', headers: { accept: 'application/json' } });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: 'req-1',
    });
  });

  it('pages a browser navigation and keeps the problem document for an API path', async () => {
    const res = await build().inject({ url: '/boom', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^text\/html/u);
    await app?.close();
    const api = build();
    api.get('/health/boom', () => {
      throw new Error('x');
    });
    const apiRes = await api.inject({ url: '/health/boom', headers: { accept: BROWSER } });
    expect(apiRes.headers['content-type']).toMatch(/^application\/problem\+json/u);
  });

  it('leaves a client error to the framework', async () => {
    const res = await build().inject({ url: '/teapot', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toMatchObject({ message: 'short and stout' });
  });

  it('shows no id it cannot show safely', async () => {
    const hostile = Fastify({ genReqId: () => '<i>' });
    hostile.setErrorHandler<FastifyError>((error, request, reply) =>
      answerServerError(error, request, reply),
    );
    hostile.get('/boom', () => {
      throw new Error('x');
    });
    const res = await hostile.inject({ url: '/boom', headers: { accept: BROWSER } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('<i>');
    expect(res.body).not.toContain('Request ID');
    await hostile.close();
  });
});

describe('an unhandled error, as the operator reads it', () => {
  interface Logged {
    err?: { type?: string; code?: string; message?: string; stack?: string };
  }

  async function logOf(failure: () => never): Promise<{ line: string; entry: Logged }> {
    const lines: string[] = [];
    const logged = Fastify({
      logger: { level: 'error', stream: { write: (line: string) => lines.push(line) } },
    });
    logged.setErrorHandler<FastifyError>((error, request, reply) =>
      answerServerError(error, request, reply),
    );
    logged.get('/boom', failure);
    await logged.inject({ url: '/boom' });
    await logged.close();
    const line = lines.find((candidate) => candidate.includes('request failed')) ?? '';
    return { line, entry: JSON.parse(line) as Logged };
  }

  it('logs the message and the stack frames of an error from the code', async () => {
    const { entry } = await logOf(() => {
      throw new TypeError('cannot read the thing');
    });
    expect(entry.err?.type).toBe('TypeError');
    expect(entry.err?.message).toBe('cannot read the thing');
    expect(entry.err?.stack).toContain('unrouted.test');
  });

  it('logs a driver error by kind and code only, since it can embed parameters', async () => {
    const { line, entry } = await logOf(() => {
      const driver = Object.assign(new Error('duplicate key value (secret@example.test)'), {
        name: 'PostgresError',
        code: '23505',
      });
      throw new Error('Failed query: insert into users params: hunter2', { cause: driver });
    });
    expect(entry.err).toEqual({ type: 'Error', code: undefined });
    expect(line).not.toMatch(/hunter2|secret@example|Failed query/u);
    expect(entry.err?.stack).toBeUndefined();
  });
});
