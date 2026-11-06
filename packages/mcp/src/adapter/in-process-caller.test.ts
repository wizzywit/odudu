import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createInProcessCaller, type InProcessCallerDeps } from '#/adapter/in-process-caller';
import { ToolProblem } from '#/service/tool';
import { tokenOf } from '#/testing/token';

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
      logger: { debug: (context, message) => logged.push(JSON.stringify({ context, message })) },
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
    const result = await createInProcessCaller(h.deps, tokenOf()).call(GET_CLIENT);
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
    await createInProcessCaller(h.deps, tokenOf()).call(GET_CLIENT);
    expect(h.injected[0]?.headers).toMatchObject({ host: 'admin.internal:8443' });
  });

  it('asks for the scope its method needs', async () => {
    const wanted: string[] = [];
    const h = harness({}, { adminBearer: (access) => (wanted.push(access), Promise.resolve('b')) });
    const caller = createInProcessCaller(h.deps, tokenOf());
    await caller.call(GET_CLIENT);
    await caller.call({ ...GET_CLIENT, method: 'PATCH', query: {} });
    expect(wanted).toEqual(['read', 'write']);
  });

  it('refuses a tool that names the tenant, before anything is sent', async () => {
    const h = harness();
    await expect(
      createInProcessCaller(h.deps, tokenOf()).call({
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
    const result = await createInProcessCaller(h.deps, tokenOf()).call(GET_CLIENT);
    expect(result.headers).toEqual({ 'content-type': 'application/json', etag: '"v1"' });
  });

  it('hands a refusal back as the admin API sent it, so a tool can phrase it', async () => {
    const problem = { type: 'urn:odudu:problem:forbidden', title: 'Forbidden', status: 403 };
    const h = harness({ statusCode: 403, payload: JSON.stringify(problem) });
    const result = await createInProcessCaller(h.deps, tokenOf()).call(GET_CLIENT);
    expect(result).toMatchObject({ status: 403, body: problem });
  });

  it('gives a body that is not JSON as null, never as text a model reads', async () => {
    const h = harness({ headers: { 'content-type': 'text/html' }, payload: '<b>hi</b>' });
    expect((await createInProcessCaller(h.deps, tokenOf()).call(GET_CLIENT)).body).toBeNull();
    const empty = harness({ statusCode: 204, payload: '' });
    expect((await createInProcessCaller(empty.deps, tokenOf()).call(GET_CLIENT)).body).toBeNull();
  });

  it('refuses a body over the cap as a problem', async () => {
    const h = harness({ payload: JSON.stringify({ text: 'x'.repeat(1_100_000) }) });
    const error = await createInProcessCaller(h.deps, tokenOf())
      .call(GET_CLIENT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolProblem);
    expect(error).toMatchObject({ problemType: 'mcp:result_too_large' });
  });

  it('writes no bearer to the log or to a failure', async () => {
    const h = harness({ statusCode: 401, payload: '' });
    await createInProcessCaller(h.deps, tokenOf()).call(GET_CLIENT);
    expect(h.logged.length).toBeGreaterThan(0);
    expect(h.logged.join('\n')).not.toContain('SECRET-BEARER');
    expect(h.logged.join('\n')).not.toMatch(/authorization/iu);

    const failing = harness({}, { inject: () => Promise.reject(new Error('boom')) });
    const error = await createInProcessCaller(failing.deps, tokenOf())
      .call(GET_CLIENT)
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('SECRET-BEARER');
  });
});
