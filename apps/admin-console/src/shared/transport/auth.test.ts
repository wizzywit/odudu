import { describe, expect, it, vi } from 'vitest';
import { createAuth } from '#/shared/transport/auth.ts';
import type { Fetch } from '#/shared/transport/gateway.ts';

const REDIRECT = `${location.origin}/tenants/acme/protocol/openid-connect/logout?id_token_hint=h&client_id=odudu-admin`;

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function harness(answer: Response | Error) {
  const calls: Call[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  const log = vi.fn<(message: string) => void>();
  return { auth: createAuth({ fetch, log }), calls, log };
}

function json(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

describe('logout', () => {
  it('posts to /console/auth/logout with the console header, no body and same-origin credentials', async () => {
    const { auth, calls } = harness(json({ redirect: REDIRECT }));

    await auth.logout();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/console/auth/logout');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(calls[0]?.init.body).toBeUndefined();
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('x-odudu-console')).toBe('1');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('content-type')).toBe(false);
  });

  it('answers the redirect the gateway names', async () => {
    const { auth } = harness(json({ redirect: REDIRECT }));

    expect(await auth.logout()).toEqual({ ok: true, redirect: REDIRECT });
  });

  it('takes the console path the gateway names when the session had already ended', async () => {
    const { auth, log } = harness(json({ redirect: '/console/' }));
    expect(await auth.logout()).toEqual({ ok: true, redirect: '/console/' });
    expect(log).not.toHaveBeenCalled();
  });

  it('refuses a scheme-relative redirect to another host', async () => {
    const { auth, log } = harness(json({ redirect: '//elsewhere.example/logout' }));
    expect(await auth.logout()).toEqual({ ok: false, kind: 'schema' });
    expect(log).toHaveBeenCalledOnce();
  });

  it.each([
    '',
    '?x',
    '#x',
    'foo',
    '/',
    '/tenants/acme/logout',
    '/console',
    '/\\elsewhere.example/',
    '\\\\elsewhere.example/',
    'javascript:alert(1)',
  ])('refuses %j, which is neither a console path nor this origin', async (redirect) => {
    const { auth, log } = harness(json({ redirect }));
    expect(await auth.logout()).toEqual({ ok: false, kind: 'schema' });
    expect(log).toHaveBeenCalledOnce();
  });

  it('takes a console path below the root, as the gateway may name', async () => {
    const { auth } = harness(json({ redirect: '/console/acme' }));
    expect(await auth.logout()).toEqual({ ok: true, redirect: '/console/acme' });
  });

  it('refuses a redirect to another origin, as the console defect it would be', async () => {
    const { auth, log } = harness(json({ redirect: 'https://elsewhere.example/logout' }));

    expect(await auth.logout()).toEqual({ ok: false, kind: 'schema' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).not.toContain('elsewhere');
  });

  it('refuses a body without a redirect', async () => {
    const { auth } = harness(json({ location: REDIRECT }));

    expect(await auth.logout()).toEqual({ ok: false, kind: 'schema' });
  });

  it('passes a refusal back as its problem', async () => {
    const { auth } = harness(
      json(
        { type: 'about:blank#console-session-ended', title: 'Unauthorized', status: 401 },
        401,
        'application/problem+json',
      ),
    );

    expect(await auth.logout()).toEqual({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank#console-session-ended', title: 'Unauthorized', status: 401 },
    });
  });

  it('reports a network failure once, without retrying', async () => {
    const { auth, calls } = harness(new TypeError('offline'));

    expect(await auth.logout()).toEqual({ ok: false, kind: 'network' });
    expect(calls).toHaveLength(1);
  });
});
