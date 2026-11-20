import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeIssuer, type FakeIssuer } from '#test/fake-issuer';
import {
  cookieSet,
  LOGIN_COOKIE,
  makeHandlers,
  ORIGIN,
  RETURN_COOKIE,
  route,
  SESSION_COOKIE,
  signIn,
  START,
  type Clock,
} from '#test/harness';

let fake: FakeIssuer;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeIssuer();
  clock = { now: START };
});
afterEach(async () => {
  await fake.close();
});

const BFF_HEADERS = { 'x-odudu-bff': '1' };
const POST_HEADERS = { ...BFF_HEADERS, origin: ORIGIN };

describe('dispatch by path', () => {
  it('sends /login to the BFF, which redirects to the issuer', async () => {
    const response = await makeHandlers(fake, clock).GET(route('/api/auth/login'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain(`${fake.issuer}/authorize`);
    expect(cookieSet(response, LOGIN_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('signs in through /login and /callback and sets the session cookie untouched', async () => {
    const handlers = makeHandlers(fake, clock);
    const { callback } = await signIn(handlers, fake);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');
    expect(callback.headers.getSetCookie()).toHaveLength(2);
    expect(cookieSet(callback, SESSION_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(
      callback.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`)),
    ).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax$/u);
  });

  it('answers /session with the claims of the signed-in browser and no token', async () => {
    const handlers = makeHandlers(fake, clock);
    const { cookie } = await signIn(handlers, fake);
    const response = await handlers.GET(
      route('/api/auth/session', { headers: BFF_HEADERS }, cookie),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      authenticated: true,
      claims: { sub: 'subject-1', name: 'Ada Lovelace' },
    });
    expect(body).not.toContain('access-token-secret-1');
    expect(body).not.toContain('refresh-token-secret-1');
  });

  it('refuses /session without the BFF header', async () => {
    const handlers = makeHandlers(fake, clock);
    const { cookie } = await signIn(handlers, fake);
    expect((await handlers.GET(route('/api/auth/session', {}, cookie))).status).toBe(403);
  });

  it('ends the session on POST /logout and clears the cookie', async () => {
    const handlers = makeHandlers(fake, clock);
    const { cookie } = await signIn(handlers, fake);
    const response = await handlers.POST(
      route('/api/auth/logout', { method: 'POST', headers: POST_HEADERS }, cookie),
    );
    expect(response.status).toBeLessThan(300);
    expect(
      response.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=;`)),
    ).toContain('Max-Age=0');
    const after = await handlers.GET(route('/api/auth/session', { headers: BFF_HEADERS }, cookie));
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ authenticated: false });
  });

  it('passes the BFF its own 405 for the wrong method', async () => {
    const handlers = makeHandlers(fake, clock);
    const post = await handlers.POST(
      route('/api/auth/login', { method: 'POST', headers: POST_HEADERS }),
    );
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    expect((await handlers.GET(route('/api/auth/logout'))).status).toBe(405);
  });

  it.each(['/api/auth', '/api/auth/', '/api/auth/nope', '/api/auth/login/x', '/elsewhere'])(
    'answers 404 for %s',
    async (path) => {
      const handlers = makeHandlers(fake, clock);
      expect((await handlers.GET(route(path))).status).toBe(404);
      expect((await handlers.POST(route(path, { method: 'POST' }))).status).toBe(404);
    },
  );

  it('sends everything below /proxy to the BFF proxy, with the session token', async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const real = globalThis.fetch;
    const handlers = makeHandlers(fake, clock, {
      upstreams: [{ name: 'api', origin: 'https://api.example', pathPrefixes: ['/orders'] }],
      deps: {
        allowInsecureRequests: true,
        now: () => clock.now,
        fetch: (input, init) => {
          const url = new Request(input).url;
          if (url.startsWith(fake.issuer)) return real(input, init);
          seen.push({ url, authorization: new Headers(init?.headers).get('authorization') });
          return Promise.resolve(Response.json({ orders: [] }));
        },
      },
    });
    const { cookie } = await signIn(handlers, fake);
    const response = await handlers.GET(
      route('/api/auth/proxy/api/orders/7?x=1', { headers: BFF_HEADERS }, cookie),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orders: [] });
    expect(seen).toEqual([
      { url: 'https://api.example/orders/7?x=1', authorization: 'Bearer access-token-secret-1' },
    ]);
    const refused = await handlers.GET(
      route('/api/auth/proxy/api/admin', { headers: BFF_HEADERS }, cookie),
    );
    expect(refused.status).toBe(403);
  });

  it('answers the proxy for every method the BFF allows', async () => {
    const handlers = makeHandlers(fake, clock, {
      upstreams: [{ name: 'api', origin: 'https://api.example', pathPrefixes: ['/x'] }],
    });
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await handlers[method](
        route('/api/auth/proxy/api/x', { method, headers: POST_HEADERS }),
      );
      expect(response.status).toBe(401);
    }
  });

  it('mounts below another path when told to', async () => {
    const handlers = makeHandlers(fake, clock, {
      mountPath: '/auth',
      redirectUri: `${ORIGIN}/auth/callback`,
    });
    expect((await handlers.GET(route('/auth/login'))).status).toBe(302);
    expect((await handlers.GET(route('/api/auth/login'))).status).toBe(404);
  });

  it('refuses a mount path that is not a clean path', () => {
    expect(() => makeHandlers(fake, clock, { mountPath: '/api/auth/' })).toThrow(TypeError);
    expect(() => makeHandlers(fake, clock, { mountPath: 'api' })).toThrow(TypeError);
  });
});

describe('returnTo', () => {
  it('clears a stale return cookie when the sign-in names no page', async () => {
    const response = await makeHandlers(fake, clock).GET(
      route('/api/auth/login', {}, `${RETURN_COOKIE}=%2Fold`),
    );
    expect(response.status).toBe(302);
    expect(
      response.headers.getSetCookie().find((line) => line.startsWith(`${RETURN_COOKIE}=;`)),
    ).toContain('Max-Age=0');
  });

  it('does not touch the return cookie when the BFF refuses the login', async () => {
    const response = await makeHandlers(fake, clock).POST(
      route('/api/auth/login', { method: 'POST', headers: POST_HEADERS }),
    );
    expect(cookieSet(response, RETURN_COOKIE)).toBeUndefined();
  });

  it('remembers a safe path across the sign-in and returns the person to it', async () => {
    const handlers = makeHandlers(fake, clock);
    const { login, callback } = await signIn(handlers, fake, '/dashboard?tab=2');
    const line = login.headers.getSetCookie().find((l) => l.startsWith(`${RETURN_COOKIE}=`));
    expect(line).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/u);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/dashboard?tab=2');
    expect(
      callback.headers.getSetCookie().find((l) => l.startsWith(`${RETURN_COOKIE}=;`)),
    ).toContain('Max-Age=0');
    expect(cookieSet(callback, SESSION_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(cookieSet(callback, LOGIN_COOKIE)).toBe('');
  });

  it.each(['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'does not remember %s',
    async (value) => {
      const handlers = makeHandlers(fake, clock);
      const { login, callback } = await signIn(handlers, fake, value);
      expect(cookieSet(login, RETURN_COOKIE)).toBe('');
      expect(callback.headers.get('location')).toBe('/');
    },
  );

  it('ignores a forged return cookie that is not a safe path', async () => {
    const handlers = makeHandlers(fake, clock);
    const login = await handlers.GET(route('/api/auth/login'));
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.claims = { nonce: authorize.searchParams.get('nonce') };
    const params = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const callback = await handlers.GET(
      route(
        `/api/auth/callback?${params.toString()}`,
        {},
        `${LOGIN_COOKIE}=${cookieSet(login, LOGIN_COOKIE) ?? ''}; ${RETURN_COOKIE}=//evil.example`,
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');
  });

  it('keeps a failed callback a failure and clears the return cookie', async () => {
    const handlers = makeHandlers(fake, clock);
    const callback = await handlers.GET(
      route('/api/auth/callback?code=x&state=nope', {}, `${RETURN_COOKIE}=/dashboard`),
    );
    expect(callback.status).toBeGreaterThanOrEqual(400);
    expect(callback.headers.get('location')).toBeNull();
    expect(
      callback.headers.getSetCookie().find((l) => l.startsWith(`${RETURN_COOKIE}=;`)),
    ).toContain('Max-Age=0');
  });
});
