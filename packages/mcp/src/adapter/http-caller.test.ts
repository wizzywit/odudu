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
  const sent: Sent[] = [];
  const asked: string[] = [];
  const logged: string[] = [];
  const tokens: TokenSource = {
    bearer: (access) => {
      asked.push(access);
      return Promise.resolve('SECRET-BEARER');
    },
  };
  const fetchStub: typeof fetch = (input, init) => {
    sent.push({ url: String(input), init: init ?? {} });
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
  return { caller, sent, asked, logged };
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
});
