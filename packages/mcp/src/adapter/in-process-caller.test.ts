import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createInProcessCaller, type InProcessCallerDeps } from '#/adapter/in-process-caller';
import { ToolProblem, type AdminRequestSpec } from '#/service/tool';
import { unverifiedTokenForTests } from '#/testing/token';

interface Harness {
  readonly deps: InProcessCallerDeps;
  readonly injected: InjectOptions[];
  readonly logged: string[];
}

function harness(
  answer: Partial<LightMyRequestResponse> & { payload?: string } = {},
  overrides: Partial<InProcessCallerDeps> = {},
): Harness {
  const injected: InjectOptions[] = [];
  const logged: string[] = [];
  const response = {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    payload: '{"ok":true}',
    ...answer,
  } as LightMyRequestResponse;
  return {
    injected,
    logged,
    deps: {
      inject: (options) => {
        injected.push(options);
        return Promise.resolve(response);
      },
      adminBearer: () => Promise.resolve('SECRET-BEARER'),
      requestId: 'req-1',
      ip: '10.0.0.9',
      adminHost: undefined,
      logger: {
        debug: (context, message) => logged.push(JSON.stringify({ context, message })),
        error: (context, message) => logged.push(JSON.stringify({ context, message })),
      },
      ...overrides,
    },
  };
}

const GET_CLIENT = {
  method: 'GET',
  pattern: '/admin/tenants/:tenant/clients/:id',
  params: { id: 'a/b c' },
  query: { expand: 'roles' },
} as const;

describe('the in-process admin caller', () => {
  it("injects a fixed request for the token's own tenant", async () => {
    const h = harness();
    const result = await createInProcessCaller(h.deps, unverifiedTokenForTests()).call(GET_CLIENT);
    expect(result).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { ok: true },
    });
    const sent = h.injected[0];
    expect(sent).toMatchObject({
      method: 'GET',
      url: '/admin/tenants/acme/clients/a%2Fb%20c',
      query: { expand: 'roles' },
      remoteAddress: '10.0.0.9',
      headers: {
        authorization: 'Bearer SECRET-BEARER',
        accept: 'application/json',
        'x-request-id': 'req-1',
        host: 'id.example.com',
      },
    });
    expect(Object.keys(sent?.headers ?? {}).sort()).toEqual([
      'accept',
      'authorization',
      'host',
      'x-request-id',
    ]);
    expect(sent?.payload).toBeUndefined();
  });

  it('takes the host from the deployment when it names one', async () => {
    const h = harness({}, { adminHost: 'admin.internal:8443' });
    await createInProcessCaller(h.deps, unverifiedTokenForTests()).call(GET_CLIENT);
    expect(h.injected[0]?.headers).toMatchObject({ host: 'admin.internal:8443' });
  });

  it('asks for the scope its method needs', async () => {
    const wanted: string[] = [];
    const h = harness({}, { adminBearer: (access) => (wanted.push(access), Promise.resolve('b')) });
    const caller = createInProcessCaller(h.deps, unverifiedTokenForTests());
    await caller.call(GET_CLIENT);
    await caller.call({ ...GET_CLIENT, method: 'PATCH', query: {} });
    expect(wanted).toEqual(['read', 'write']);
  });

  it('refuses a tool that names the tenant, before anything is sent', async () => {
    const h = harness();
    await expect(
      createInProcessCaller(h.deps, unverifiedTokenForTests()).call({
        ...GET_CLIENT,
        params: { id: 'x', tenant: 'other' },
      }),
    ).rejects.toThrow('tenant');
    expect(h.injected).toEqual([]);
  });

  it('returns only whitelisted headers and never a cookie', async () => {
    const h = harness({
      headers: {
        'content-type': 'application/json',
        etag: '"v1"',
        'set-cookie': 'sid=1',
        'www-authenticate': 'Bearer realm="x"',
        'x-secret': 'no',
      },
    });
    const result = await createInProcessCaller(h.deps, unverifiedTokenForTests()).call(GET_CLIENT);
    expect(result.headers).toEqual({ 'content-type': 'application/json', etag: '"v1"' });
  });

  it('hands a refusal back as the admin API sent it, so a tool can phrase it', async () => {
    const problem = { type: 'urn:odudu:problem:forbidden', title: 'Forbidden', status: 403 };
    const h = harness({ statusCode: 403, payload: JSON.stringify(problem) });
    const result = await createInProcessCaller(h.deps, unverifiedTokenForTests()).call(GET_CLIENT);
    expect(result).toMatchObject({ status: 403, body: problem });
  });

  it('gives a body that is not JSON as null, never as text a model reads', async () => {
    const h = harness({ headers: { 'content-type': 'text/html' }, payload: '<b>hi</b>' });
    expect(
      (await createInProcessCaller(h.deps, unverifiedTokenForTests()).call(GET_CLIENT)).body,
    ).toBeNull();
    const empty = harness({ statusCode: 204, payload: '' });
    expect(
      (await createInProcessCaller(empty.deps, unverifiedTokenForTests()).call(GET_CLIENT)).body,
    ).toBeNull();
  });

  it('refuses a body over the cap as a problem', async () => {
    const h = harness({ payload: JSON.stringify({ text: 'x'.repeat(1_100_000) }) });
    const error = await createInProcessCaller(h.deps, unverifiedTokenForTests())
      .call(GET_CLIENT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolProblem);
    expect(error).toMatchObject({ problemType: 'mcp:result_too_large' });
  });

  it('writes no bearer to the log or to a failure', async () => {
    const h = harness({ statusCode: 401, payload: '' });
    await createInProcessCaller(h.deps, unverifiedTokenForTests()).call(GET_CLIENT);
    expect(h.logged.length).toBeGreaterThan(0);
    expect(h.logged.join('\n')).not.toContain('SECRET-BEARER');
    expect(h.logged.join('\n')).not.toMatch(/authorization/iu);

    const failing = harness({}, { inject: () => Promise.reject(new Error('boom')) });
    const error = await createInProcessCaller(failing.deps, unverifiedTokenForTests())
      .call(GET_CLIENT)
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('SECRET-BEARER');
  });

  it("injects a url shaped as the tool's pattern for any id, or refuses before injecting", async () => {
    const hostile = [
      '..',
      '.',
      '',
      '%2e%2e',
      '%2E',
      '..%2f',
      '/',
      '\\',
      '?x',
      '#x',
      '\u2024',
      '\uFF0E\uFF0E',
      'a'.repeat(100_000),
    ];
    for (const id of hostile) {
      const h = harness();
      const spec = { ...GET_CLIENT, params: { id } };
      await createInProcessCaller(h.deps, unverifiedTokenForTests())
        .call(spec)
        .catch(() => undefined);
      for (const sent of h.injected) {
        const url = typeof sent.url === 'string' ? sent.url : '';
        const segments = url.split('/');
        expect(segments.length, id).toBe(GET_CLIENT.pattern.split('/').length);
        expect(segments.slice(0, 5), id).toEqual(['', 'admin', 'tenants', 'acme', 'clients']);
        expect(url, id).not.toMatch(/[?#\\]|\/\.{1,2}(\/|$)/u);
        expect(new URL(url, 'http://x').pathname, id).toBe(url);
      }
      if (id === '' || id === '.' || id === '..') expect(h.injected, id).toHaveLength(0);
    }
  });

  describe('a body', () => {
    const PATCH = {
      method: 'PATCH',
      pattern: '/admin/tenants/:tenant/clients/:id',
      params: { id: '0192a0a0-0000-7000-8000-000000000001' },
      query: {},
    } as const;

    it('is serialised as JSON under a fixed content type, and only then', async () => {
      const h = harness();
      await createInProcessCaller(h.deps, unverifiedTokenForTests({ scope: ['mcp:write'] })).call({
        ...PATCH,
        body: { description: 'new text', name_i18n: { en: 'Portal' } },
      });
      const sent = h.injected[0];
      expect(sent?.payload).toBe('{"description":"new text","name_i18n":{"en":"Portal"}}');
      expect(Object.keys(sent?.headers ?? {}).sort()).toEqual([
        'accept',
        'authorization',
        'content-type',
        'host',
        'x-request-id',
      ]);
      expect(sent?.headers?.['content-type']).toBe('application/json');
    });

    it('is refused on a GET, as a raw string, as an array, and above 64 KiB', async () => {
      const refusals: unknown[] = [
        { ...GET_CLIENT, body: { a: 1 } },
        { ...PATCH, body: '{"a":1}' },
        { ...PATCH, body: [1] },
        { ...PATCH, body: { description: 'x'.repeat(70_000) } },
      ];
      for (const spec of refusals) {
        const h = harness();
        await expect(
          createInProcessCaller(h.deps, unverifiedTokenForTests({ scope: ['mcp:write'] })).call(
            spec as AdminRequestSpec,
          ),
        ).rejects.toThrow();
        expect(h.injected).toHaveLength(0);
      }
    });

    it('carries the etag it was given as If-Match, the one header a tool may cause', async () => {
      const h = harness();
      const etag = `"${'a'.repeat(64)}"`;
      await createInProcessCaller(h.deps, unverifiedTokenForTests({ scope: ['mcp:write'] })).call({
        ...PATCH,
        body: { description: 'd' },
        ifMatch: etag,
      });
      expect(Object.keys(h.injected[0]?.headers ?? {}).sort()).toEqual([
        'accept',
        'authorization',
        'content-type',
        'host',
        'if-match',
        'x-request-id',
      ]);
      expect(h.injected[0]?.headers?.['if-match']).toBe(etag);
    });

    it('refuses an If-Match that is not one strong etag, and one on a GET, before sending', async () => {
      const refusals: unknown[] = [
        { ...PATCH, body: { a: 'b' }, ifMatch: '*' },
        { ...PATCH, body: { a: 'b' }, ifMatch: 'W/"x"' },
        { ...PATCH, body: { a: 'b' }, ifMatch: '"a", "b"' },
        { ...PATCH, body: { a: 'b' }, ifMatch: '"a"\r\nx-evil: 1' },
        { ...PATCH, body: { a: 'b' }, ifMatch: '' },
        { ...PATCH, body: { a: 'b' }, ifMatch: `"${'a'.repeat(300)}"` },
        { ...GET_CLIENT, ifMatch: '"a"' },
      ];
      for (const spec of refusals) {
        const h = harness();
        await expect(
          createInProcessCaller(h.deps, unverifiedTokenForTests({ scope: ['mcp:write'] })).call(
            spec as AdminRequestSpec,
          ),
        ).rejects.toThrow();
        expect(h.injected).toHaveLength(0);
      }
    });

    it('is sent after a bearer of write access', async () => {
      const accesses: string[] = [];
      const h = harness(
        {},
        {
          adminBearer: (access) => {
            accesses.push(access);
            return Promise.resolve('B');
          },
        },
      );
      await createInProcessCaller(h.deps, unverifiedTokenForTests({ scope: ['mcp:write'] })).call({
        ...PATCH,
        body: { description: 'd' },
      });
      expect(accesses).toEqual(['write']);
    });
  });
});
