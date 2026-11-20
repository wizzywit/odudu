import { createMemoryStore } from '@odudu-io/bff';
import { NextRequest } from 'next/server.js';
import { describe, expect, it } from 'vitest';
import { withAuth } from '#/use-cases/with-auth';

const ORIGIN = 'https://app.example';
const ID = 'B'.repeat(43);

const ask = (path: string, cookie?: string): NextRequest =>
  new NextRequest(`${ORIGIN}${path}`, cookie === undefined ? {} : { headers: { cookie } });

const REDIRECT_STATUS = 307;

describe('withAuth, by the cookie alone', () => {
  const proxy = withAuth({ paths: ['/dashboard', '/account'] });

  it('sends an anonymous request for a protected path to the login route', async () => {
    const response = await proxy(ask('/dashboard/settings?tab=2'));
    expect(response.status).toBe(REDIRECT_STATUS);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe('/api/auth/login');
    expect(location.searchParams.get('returnTo')).toBe('/dashboard/settings?tab=2');
  });

  it('lets a request with the session cookie through', async () => {
    const response = await proxy(ask('/dashboard', `__Host-odudu=${ID}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('ignores a path it does not protect', async () => {
    const response = await proxy(ask('/pricing'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not read a prefix that only looks the same as a protected path', async () => {
    expect((await proxy(ask('/dashboards'))).headers.get('location')).toBeNull();
  });

  it('treats a missing, empty or other-named cookie as signed out', async () => {
    for (const cookie of [undefined, '__Host-odudu=', 'odudu=abc', `__Host-odudu-login=${ID}`]) {
      const response = await proxy(ask('/account', cookie));
      expect(response.status).toBe(REDIRECT_STATUS);
    }
  });

  it('falls back to / for a path that is not a safe return target', async () => {
    for (const path of ['//evil.example/x', '/\\evil.example']) {
      const guard = withAuth({ paths: ['/'] });
      const response = await guard(new NextRequest(new URL(`${ORIGIN}${path}`, ORIGIN)));
      const target = new URL(response.headers.get('location') ?? '');
      expect(target.origin).toBe(ORIGIN);
      expect(target.searchParams.get('returnTo')).toBe('/');
    }
  });

  it('uses the cookie and login route it was given', async () => {
    const custom = withAuth({
      paths: ['/app'],
      cookieName: '__Host-shop',
      loginPath: '/sign-in/start',
    });
    expect((await custom(ask('/app', `__Host-shop=${ID}`))).headers.get('location')).toBeNull();
    const response = await custom(ask('/app'));
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/sign-in/start');
  });

  it('never redirects the sign-in routes, which would loop', async () => {
    const guard = withAuth({ paths: ['/'] });
    const response = await guard(ask('/api/auth/login'));
    expect(response.headers.get('location')).toBeNull();
    expect((await guard(ask('/api/auth/callback?code=x'))).headers.get('location')).toBeNull();
  });

  it('refuses a login path that is not a path of this origin', () => {
    expect(() => withAuth({ paths: ['/'], loginPath: 'https://evil.example/login' })).toThrow(
      TypeError,
    );
    expect(() => withAuth({ paths: ['/'], loginPath: '//evil.example' })).toThrow(TypeError);
  });
});

describe('withAuth, with a store', () => {
  const sessionRecord = {
    kind: 'session' as const,
    tokens: {} as never,
    createdAt: 0,
  };

  it('lets through a cookie whose id the store holds as a session', async () => {
    const store = createMemoryStore();
    await store.set(ID, sessionRecord, 60_000);
    const guard = withAuth({ paths: ['/dashboard'], store });
    expect(
      (await guard(ask('/dashboard', `__Host-odudu=${ID}`))).headers.get('location'),
    ).toBeNull();
  });

  it('sends a cookie the store does not know to sign in', async () => {
    const guard = withAuth({ paths: ['/dashboard'], store: createMemoryStore() });
    const response = await guard(ask('/dashboard', `__Host-odudu=${ID}`));
    expect(response.status).toBe(REDIRECT_STATUS);
  });

  it('does not take a login record for a session', async () => {
    const store = createMemoryStore();
    await store.set(ID, { kind: 'login', pending: {} as never, createdAt: 0 }, 60_000);
    const guard = withAuth({ paths: ['/dashboard'], store });
    expect((await guard(ask('/dashboard', `__Host-odudu=${ID}`))).status).toBe(REDIRECT_STATUS);
  });

  it('asks the store once per request and not at all for an unprotected path', async () => {
    let calls = 0;
    const base = createMemoryStore();
    const store = {
      ...base,
      get: (id: string) => {
        calls += 1;
        return base.get(id);
      },
    };
    const guard = withAuth({ paths: ['/dashboard'], store });
    await guard(ask('/pricing', `__Host-odudu=${ID}`));
    await guard(ask('/dashboard'));
    expect(calls).toBe(0);
    await guard(ask('/dashboard', `__Host-odudu=${ID}`));
    expect(calls).toBe(1);
  });
});
