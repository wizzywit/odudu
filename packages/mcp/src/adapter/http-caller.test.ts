import { describe, expect, it } from 'vitest';
import { createHttpCaller } from '#/adapter/http-caller';
import { ADMIN_BODY_CAP_BYTES } from '#/service/admin-request';
import { ToolProblem, type AdminRequestSpec } from '#/service/tool';
import type { TokenSource } from '#/service/token-source';

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function harness(answer: () => Response | Promise<Response> = () => json({ ok: true })) {
  const invalidated: { count: number; rejected: string[] } = { count: 0, rejected: [] };
  const sent: Sent[] = [];
  const asked: string[] = [];
  const logged: string[] = [];
  const tokens: TokenSource = {
    bearer: (access) => {
      asked.push(access);
      return Promise.resolve('SECRET-BEARER');
    },
    invalidate: (rejected) => {
      invalidated.count += 1;
      invalidated.rejected.push(rejected);
    },
  };
  const fetchStub: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    sent.push({ url, init: init ?? {} });
    return Promise.resolve(answer());
  };
  const caller = createHttpCaller('https://id.example.com', tokens, {
    tenant: 'acme',
    fetch: fetchStub,
    requestId: () => 'req-1',
    logger: {
      debug: (context, message) => logged.push(JSON.stringify({ context, message })),
      error: (context, message) => logged.push(JSON.stringify({ context, message })),
    },
  });
  return { caller, sent, asked, logged, invalidated };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });

const GET_CLIENT: AdminRequestSpec = {
  method: 'GET',
  pattern: '/admin/tenants/:tenant/clients/:id',
  params: { id: 'a/b c' },
  query: { expand: 'roles' },
};

describe('the stdio caller of the admin API', () => {
  it('asks an instance-level read at the instance, with its filters as query and no tenant', async () => {
    const h = harness();
    await h.caller.call({
      method: 'GET',
      pattern: '/admin/tenants/count',
      params: {},
      query: { name: 'ac' },
    });
    expect(h.sent[0]?.url).toBe('https://id.example.com/admin/tenants/count?name=ac');
  });

  it('refuses a pattern with no tenant that is not an instance-level read, before any request', async () => {
    const h = harness();
    await expect(
      h.caller.call({ method: 'GET', pattern: '/admin/tenant-imports', params: {}, query: {} }),
    ).rejects.toThrow();
    expect(h.sent).toEqual([]);
  });

  it('sends a fixed request for the configured tenant, and nothing else in its headers', async () => {
    const h = harness();
    const result = await h.caller.call(GET_CLIENT);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.url).toBe(
      'https://id.example.com/admin/tenants/acme/clients/a%2Fb%20c?expand=roles',
    );
    expect(h.sent[0]?.init.method).toBe('GET');
    expect(h.sent[0]?.init.headers).toEqual({
      authorization: 'Bearer SECRET-BEARER',
      accept: 'application/json',
      'x-request-id': 'req-1',
    });
    expect(h.sent[0]?.init.redirect).toBe('manual');
    expect(h.sent[0]?.init.credentials).toBe('omit');
    expect(result).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { ok: true },
    });
  });

  it('asks for a read bearer for a GET and a write bearer for a PATCH', async () => {
    const h = harness();
    await h.caller.call(GET_CLIENT);
    await h.caller.call({
      method: 'PATCH',
      pattern: '/admin/tenants/:tenant/scopes/:id',
      params: { id: 's1' },
      query: {},
      body: { description: 'x' },
      ifMatch: '"v1"',
    });
    expect(h.asked).toEqual(['read', 'write']);
  });

  it('adds a fixed content type, the body and the precondition for a PATCH only', async () => {
    const h = harness();
    await h.caller.call({
      method: 'PATCH',
      pattern: '/admin/tenants/:tenant/scopes/:id',
      params: { id: 's1' },
      query: {},
      body: { description: 'x' },
      ifMatch: '"v1"',
    });
    expect(h.sent[0]?.init.headers).toEqual({
      authorization: 'Bearer SECRET-BEARER',
      accept: 'application/json',
      'x-request-id': 'req-1',
      'content-type': 'application/json',
      'if-match': '"v1"',
    });
    expect(h.sent[0]?.init.body).toBe('{"description":"x"}');
  });

  it('refuses a tool that names the tenant, a body on a GET and a weak precondition', async () => {
    const h = harness();
    await expect(
      h.caller.call({ ...GET_CLIENT, params: { id: 'x', tenant: 'other' } }),
    ).rejects.toThrow(/tenant/u);
    await expect(h.caller.call({ ...GET_CLIENT, body: { a: 'b' } })).rejects.toThrow(/PATCH/u);
    await expect(
      h.caller.call({
        method: 'PATCH',
        pattern: '/admin/tenants/:tenant/scopes/:id',
        params: { id: 's1' },
        query: {},
        body: {},
        ifMatch: 'W/"v1"',
      }),
    ).rejects.toThrow(/strong/u);
    expect(h.sent).toHaveLength(0);
  });

  it('builds each write method from fixed parts, with only the headers it names', async () => {
    const h = harness();
    const etag = `"${'c'.repeat(64)}"`;
    await h.caller.call({
      method: 'POST',
      pattern: '/admin/tenants/:tenant/roles',
      params: {},
      query: {},
      body: { name: 'auditors' },
      idempotencyKey: 'create-auditors-1',
    });
    await h.caller.call({
      method: 'PUT',
      pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
      params: { locale: 'de', key: 'login.title' },
      query: {},
      body: { message: 'x' },
      ifMatch: etag,
    });
    await h.caller.call({
      method: 'DELETE',
      pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
      params: { locale: 'de', key: 'login.title' },
      query: {},
      ifMatch: etag,
    });
    const names = h.sent.map((s) => Object.keys(s.init.headers ?? {}).sort());
    expect(names).toEqual([
      ['accept', 'authorization', 'content-type', 'idempotency-key', 'x-request-id'],
      ['accept', 'authorization', 'content-type', 'if-match', 'x-request-id'],
      ['accept', 'authorization', 'if-match', 'x-request-id'],
    ]);
    expect(h.sent.map((s) => s.init.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(h.sent[0]?.init.body).toBe('{"name":"auditors"}');
    expect(h.sent[2]?.init.body).toBeUndefined();
    expect(h.asked).toEqual(['write', 'write', 'write']);
  });

  it('refuses a bad key, a body on a DELETE and a cap above the read cap before any request', async () => {
    const h = harness();
    const post = {
      method: 'POST',
      pattern: '/admin/tenants/:tenant/roles',
      params: {},
      query: {},
      body: { name: 'a' },
    } as const;
    for (const idempotencyKey of ['a b', 'a\nb', 'k'.repeat(256), '']) {
      await expect(h.caller.call({ ...post, idempotencyKey })).rejects.toThrow(/key/u);
    }
    await expect(h.caller.call(post)).rejects.toThrow(/key/u);
    await expect(
      h.caller.call({ ...post, idempotencyKey: 'k', bodyCap: 1_048_577 }),
    ).rejects.toThrow(/cap/u);
    await expect(
      h.caller.call({
        method: 'DELETE',
        pattern: '/admin/tenants/:tenant/roles/:id',
        params: { id: 'r' },
        query: {},
        body: { a: 'b' },
      }),
    ).rejects.toThrow(/PATCH, POST or PUT/u);
    expect(h.sent).toHaveLength(0);
  });

  it('sends the same key again when a 401 makes it ask once more', async () => {
    let calls = 0;
    const h = harness(() =>
      calls++ === 0 ? new Response(null, { status: 401 }) : json({ ok: 1 }),
    );
    await h.caller.call({
      method: 'POST',
      pattern: '/admin/tenants/:tenant/roles',
      params: {},
      query: {},
      body: { name: 'a' },
      idempotencyKey: 'same-key',
    });
    expect(
      h.sent.map((s) => (s.init.headers as Record<string, string>)['idempotency-key']),
    ).toEqual(['same-key', 'same-key']);
  });

  it('does not follow a redirect and says so', async () => {
    const h = harness(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    );
    const error = await h.caller.call(GET_CLIENT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolProblem);
    expect((error as ToolProblem).problemType).toBe('mcp:redirect_refused');
    expect(h.sent).toHaveLength(1);
  });

  it('refuses a result over the cap, by its length and by what it streams', async () => {
    const big = 'x'.repeat(ADMIN_BODY_CAP_BYTES + 1);
    const byLength = harness(
      () => new Response(big, { headers: { 'content-type': 'application/json' } }),
    );
    await expect(byLength.caller.call(GET_CLIENT)).rejects.toMatchObject({
      problemType: 'mcp:result_too_large',
    });
    const streamed = harness(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode('x'.repeat(100_000)));
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(streamed.caller.call(GET_CLIENT)).rejects.toMatchObject({
      problemType: 'mcp:result_too_large',
    });
  });

  it('returns only the three headers a tool reads, and null for a body that is not JSON', async () => {
    const h = harness(
      () =>
        new Response('<html>', {
          status: 502,
          headers: {
            'content-type': 'text/html',
            'set-cookie': 'a=b',
            etag: '"e"',
            'retry-after': '3',
          },
        }),
    );
    expect(await h.caller.call(GET_CLIENT)).toEqual({
      status: 502,
      headers: { 'content-type': 'text/html', etag: '"e"', 'retry-after': '3' },
      body: null,
    });
  });

  it('reports a network failure without the address, the error or the bearer', async () => {
    const tokens: TokenSource = { bearer: () => Promise.resolve('SECRET-BEARER') };
    const failing: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed: https://id.example.com SECRET-BEARER'));
    const caller = createHttpCaller('https://id.example.com', tokens, {
      tenant: 'acme',
      fetch: failing,
    });
    const error = await caller.call(GET_CLIENT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolProblem);
    const problem = error as ToolProblem;
    expect(problem.problemType).toBe('mcp:unreachable');
    expect(JSON.stringify([problem.message, problem.detail])).not.toMatch(/SECRET|example\.com/u);
  });

  it('never logs the bearer', async () => {
    const h = harness();
    await h.caller.call(GET_CLIENT);
    expect(h.logged.length).toBeGreaterThan(0);
    expect(h.logged.join('\n')).not.toContain('SECRET');
  });

  it('refuses plain HTTP to a host that is not loopback, and allows it to one that is', () => {
    const tokens: TokenSource = { bearer: () => Promise.resolve('t') };
    expect(() => createHttpCaller('http://id.example.com', tokens, { tenant: 'acme' })).toThrow(
      /https/u,
    );
    expect(() =>
      createHttpCaller('http://127.0.0.1:3000', tokens, { tenant: 'acme' }),
    ).not.toThrow();
  });

  it('drops the token on a 401 and retries once with a fresh one, then answers whatever comes', async () => {
    let n = 0;
    const h = harness(() => (n++ === 0 ? json({ no: 1 }, { status: 401 }) : json({ ok: true })));
    expect((await h.caller.call(GET_CLIENT)).status).toBe(200);
    expect(h.invalidated.count).toBe(1);
    expect(h.invalidated.rejected).toEqual(['SECRET-BEARER']);
    expect(h.sent).toHaveLength(2);
    expect(h.asked).toEqual(['read', 'read']);

    const always = harness(() => json({ no: 1 }, { status: 401 }));
    expect((await always.caller.call(GET_CLIENT)).status).toBe(401);
    expect(always.sent).toHaveLength(2);
    expect(always.invalidated.count).toBe(1);
  });

  it('does not retry a write that was refused as unauthenticated more than once, nor any other status', async () => {
    const h = harness(() => json({ no: 1 }, { status: 403 }));
    expect((await h.caller.call(GET_CLIENT)).status).toBe(403);
    expect(h.sent).toHaveLength(1);
    expect(h.invalidated.count).toBe(0);
  });
});
