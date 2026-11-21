import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import {
  cookieSet,
  makeBff,
  ORIGIN,
  request,
  setCookieLine,
  signIn,
  START,
  type Clock,
} from '#/testing/harness';
import { createMemoryStore } from '#/services/memory-store';
import type { SessionStore } from '#/types';

let fake: FakeServer;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeServer();
  clock = { now: START };
});
afterEach(async () => {
  await fake.close();
});

const post = (path: string, cookie: string | undefined, headers: Record<string, string>): Request =>
  request(path, cookie, { method: 'POST', headers });
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/u;
const sessionRequest = (cookie: string | undefined): Request =>
  request('/auth/session', cookie, { headers: { 'x-odudu-bff': '1' } });
const csrfHeaders = { 'x-odudu-bff': '1', origin: ORIGIN };

describe('login', () => {
  it('redirects with state bound to a pre-session cookie', async () => {
    const bff = makeBff(fake, clock);
    const response = await bff.login(request('/auth/login', undefined));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(`${fake.issuer}/authorize`);
    expect(location.searchParams.get('state')).toMatch(/\S{16}/u);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    const line = setCookieLine(response, '__Host-odudu-login');
    expect(line).toMatch(/^__Host-odudu-login=[A-Za-z0-9_-]{43};/u);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    expect(line).not.toContain('Domain');
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(location.href).not.toContain(cookieSet(response, '__Host-odudu-login'));
  });

  it('answers 405 to a POST', async () => {
    const response = await makeBff(fake, clock).login(post('/auth/login', undefined, csrfHeaders));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});

describe('callback', () => {
  it('creates a __Host- HttpOnly Secure SameSite=Lax cookie holding only a random id', async () => {
    const bff = makeBff(fake, clock);
    const { callback } = await signIn(bff, fake);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');
    const line = setCookieLine(callback, '__Host-odudu');
    expect(line).toMatch(
      /^__Host-odudu=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax$/u,
    );
    expect(line).not.toMatch(/Max-Age|Expires|Domain/u);
    expect(cookieSet(callback, '__Host-odudu-login')).toBe('');
    expect(setCookieLine(callback, '__Host-odudu-login')).toContain('Max-Age=0');
  });

  it('makes a different id for every sign-in', async () => {
    const bff = makeBff(fake, clock);
    const first = await signIn(bff, fake);
    const second = await signIn(bff, fake);
    expect(first.cookie).not.toBe(second.cookie);
  });

  it('never puts a token in the cookie or the redirect', async () => {
    const { callback, cookie } = await signIn(makeBff(fake, clock), fake);
    const everything = `${cookie} ${callback.headers.get('location') ?? ''} ${callback.headers.getSetCookie().join(' ')}`;
    expect(everything).not.toMatch(/access-token|refresh-token/u);
  });

  it('answers 400 for a state that does not match and sets no session cookie', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.claims = { nonce: authorize.searchParams.get('nonce') };
    const params = new URLSearchParams({ code: 'c', state: 'forged', iss: fake.issuer });
    const response = await bff.callback(
      request(
        `/auth/callback?${params.toString()}`,
        `__Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Sign-in failed.');
    expect(cookieSet(response, '__Host-odudu')).toBeUndefined();
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('answers 400 for an iss that differs and never echoes it', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const authorize = new URL(login.headers.get('location') ?? '');
    const params = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: 'https://evil.example/leaked-marker',
    });
    const response = await bff.callback(
      request(
        `/auth/callback?${params.toString()}`,
        `__Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('leaked-marker');
    expect(cookieSet(response, '__Host-odudu')).toBeUndefined();
  });

  it('answers 502 when the issuer refuses the BFF secret, whatever the status', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.tokenError = { error: 'invalid_client', error_description: 'upstream-words' };
    fake.tokenChallenge = true;
    const params = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const response = await bff.callback(
      request(
        `/auth/callback?${params.toString()}`,
        `__Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`,
      ),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('upstream-words');
  });

  it('answers 400 for a code the issuer refuses, without its words', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.tokenError = { error: 'invalid_grant', error_description: 'upstream-words' };
    const params = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const response = await bff.callback(
      request(
        `/auth/callback?${params.toString()}`,
        `__Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('upstream-words');
    expect(cookieSet(response, '__Host-odudu')).toBeUndefined();
  });

  it('spends the login record even when the sign-in fails', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const loginCookie = `__Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`;
    const authorize = new URL(login.headers.get('location') ?? '');
    const bad = new URLSearchParams({ code: 'c', state: 'forged', iss: fake.issuer });
    await bff.callback(request(`/auth/callback?${bad.toString()}`, loginCookie));
    fake.claims = { nonce: authorize.searchParams.get('nonce') };
    const good = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const replay = await bff.callback(request(`/auth/callback?${good.toString()}`, loginCookie));
    expect(replay.status).toBe(400);
  });

  it('answers 400 to a callback with no login cookie', async () => {
    const response = await makeBff(fake, clock).callback(
      request('/auth/callback?code=c&state=s', undefined),
    );
    expect(response.status).toBe(400);
  });

  it('answers 400 to a login cookie that names no record', async () => {
    const response = await makeBff(fake, clock).callback(
      request('/auth/callback?code=c&state=s', `__Host-odudu-login=${'A'.repeat(43)}`),
    );
    expect(response.status).toBe(400);
  });

  it('sends the person to afterSignInPath when it is set', async () => {
    const { callback } = await signIn(
      makeBff(fake, clock, { afterSignInPath: '/dashboard' }),
      fake,
    );
    expect(callback.headers.get('location')).toBe('/dashboard');
  });
});

describe('session', () => {
  it('[RFC10017-6.1.3.3.2-01] answers 403 without the X-Odudu-BFF header and serves with it', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    const bare = await bff.session(request('/auth/session', cookie));
    expect(bare.status).toBe(403);
    expect(await bare.text()).toBe('');
    const foreign = await bff.session(
      request('/auth/session', cookie, {
        headers: { 'x-odudu-bff': '1', origin: 'https://evil.example' },
      }),
    );
    expect(foreign.status).toBe(403);
    expect((await bff.session(sessionRequest(cookie))).status).toBe(200);
  });

  it('answers 401 and ends a session whose tokens expired with no refresh token', async () => {
    fake.issueRefreshToken = false;
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    expect((await bff.session(sessionRequest(cookie))).status).toBe(200);
    clock.now += 900_000;
    const ended = await bff.session(sessionRequest(cookie));
    expect(ended.status).toBe(401);
    expect(ended.headers.getSetCookie().join(' ')).toContain('__Host-odudu=;');
    expect(await (await bff.session(sessionRequest(cookie))).json()).toEqual({
      authenticated: false,
    });
  });

  it('returns claims and never a token', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    const response = await bff.session(sessionRequest(cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const raw = await response.text();
    const body = JSON.parse(raw) as { authenticated: boolean; claims: { sub: string } };
    expect(body.authenticated).toBe(true);
    expect(body.claims.sub).toBe('subject-1');
    expect(raw).not.toMatch(/access-token|refresh-token|"idToken"/u);
    expect(raw).not.toContain(cookie.split('=')[1] ?? 'x');
    expect(Object.keys(body)).toEqual(['authenticated', 'claims']);
  });

  it('says not authenticated to a browser with no cookie', async () => {
    const response = await makeBff(fake, clock).session(sessionRequest(undefined));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('says not authenticated, not 500, to a tampered or unknown id', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    const unknown = `__Host-odudu=${'B'.repeat(43)}`;
    const tampered = `${cookie}x`;
    const junk = '__Host-odudu=../../etc/passwd';
    for (const probe of [unknown, tampered, junk]) {
      const response = await bff.session(sessionRequest(probe));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ authenticated: false });
    }
  });

  it('does not accept the login cookie value as a session', async () => {
    const bff = makeBff(fake, clock);
    const login = await bff.login(request('/auth/login', undefined));
    const stolen = `__Host-odudu=${cookieSet(login, '__Host-odudu-login') ?? ''}`;
    const response = await bff.session(sessionRequest(stolen));
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('makes no token request while the access token is fresh', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 800_000;
    await bff.session(sessionRequest(cookie));
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it('refreshes inside the skew and keeps the rotated tokens', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 880_000;
    const first = await bff.session(sessionRequest(cookie));
    expect(first.status).toBe(200);
    expect(fake.tokenRequests).toHaveLength(2);
    expect(fake.tokenRequests[1]?.get('grant_type')).toBe('refresh_token');
    expect(fake.tokenRequests[1]?.get('refresh_token')).toBe('refresh-token-1');
    await bff.session(sessionRequest(cookie));
    expect(fake.tokenRequests).toHaveLength(2);
    clock.now += 880_000;
    await bff.session(sessionRequest(cookie));
    expect(fake.tokenRequests[2]?.get('refresh_token')).toBe('refresh-token-1-rotated');
  });

  it('answers 401, deletes the session and clears the cookie when the refresh is refused', async () => {
    const store = createMemoryStore({ now: () => clock.now });
    const bff = makeBff(fake, clock, { store });
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.tokenError = { error: 'invalid_grant', error_description: 'revoked' };
    const response = await bff.session(sessionRequest(cookie));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(setCookieLine(response, '__Host-odudu')).toContain('Max-Age=0');
    fake.tokenError = undefined;
    const after = await bff.session(sessionRequest(cookie));
    expect(await after.json()).toEqual({ authenticated: false });
    expect(after.status).toBe(200);
    expect(fake.tokenRequests).toHaveLength(2);
  });

  it('keeps the session when the issuer cannot be reached for a refresh', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.tokenError = { error: 'server_error' };
    const down = await bff.session(sessionRequest(cookie));
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('5');
    expect(down.headers.getSetCookie()).toHaveLength(0);
    fake.tokenError = undefined;
    const back = await bff.session(sessionRequest(cookie));
    expect(back.status).toBe(200);
  });

  it('concurrent session reads cause one refresh', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.refreshDelayMs = 40;
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => bff.session(sessionRequest(cookie))),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(fake.tokenRequests.filter((f) => f.get('grant_type') === 'refresh_token')).toHaveLength(
      1,
    );
  });

  it('a read that loaded before a refresh finished does not spend the replaced token', async () => {
    const stale = createMemoryStore({ now: () => clock.now });
    let delayRead = false;
    let release: () => void = () => undefined;
    const store: SessionStore = {
      set: (id, value, ttl) => stale.set(id, value, ttl),
      delete: (id) => stale.delete(id),
      get: async (id) => {
        const value = await stale.get(id);
        if (delayRead) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return value;
      },
    };
    const bff = makeBff(fake, clock, { store });
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    delayRead = true;
    const late = bff.session(sessionRequest(cookie));
    await new Promise((resolve) => setTimeout(resolve, 10));
    delayRead = false;
    const early = await bff.session(sessionRequest(cookie));
    expect(early.status).toBe(200);
    release();
    expect((await late).status).toBe(200);
    expect(fake.tokenRequests.filter((f) => f.get('grant_type') === 'refresh_token')).toHaveLength(
      1,
    );
  });
});

describe('tokens', () => {
  it('no route puts a JWT-shaped string in a response', async () => {
    const bff = makeBff(fake, clock, { postLogoutRedirectUri: 'https://app.example/' });
    const { cookie, login, callback } = await signIn(bff, fake);
    const session = await bff.session(sessionRequest(cookie));
    const logout = await bff.logout(post('/auth/logout', cookie, csrfHeaders));
    for (const response of [login, callback, session, logout]) {
      const everything = `${[...response.headers].join(' ')} ${await response.text()}`;
      expect(everything).not.toMatch(JWT_SHAPED);
    }
  });
});

describe('refresh failures', () => {
  it('never adopts the subject a refresh response names when it is another one', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.claims = { ...fake.claims, sub: 'someone-else' };
    const swapped = await bff.session(sessionRequest(cookie));
    expect(swapped.status).toBe(503);
    fake.claims = { ...fake.claims, sub: 'subject-1' };
    const after = await bff.session(sessionRequest(cookie));
    expect(JSON.stringify(await after.json())).not.toContain('someone-else');
  });

  it('keeps the session when the client secret is refused (invalid_client)', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.tokenError = { error: 'invalid_client' };
    const refused = await bff.session(sessionRequest(cookie));
    expect(refused.status).toBe(503);
    expect(refused.headers.getSetCookie()).toHaveLength(0);
    fake.tokenError = undefined;
    const back = await bff.session(sessionRequest(cookie));
    expect(back.status).toBe(200);
  });

  it('keeps the session when Odudu refuses the secret with a 401 challenge', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.tokenError = { error: 'invalid_client' };
    fake.tokenChallenge = true;
    const refused = await bff.session(sessionRequest(cookie));
    expect(refused.status).toBe(503);
    expect(refused.headers.getSetCookie()).toHaveLength(0);
    fake.tokenChallenge = false;
    fake.tokenError = undefined;
    expect((await bff.session(sessionRequest(cookie))).status).toBe(200);
  });

  it('ends the session when a 401 challenge says invalid_grant', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.tokenError = { error: 'invalid_grant' };
    fake.tokenChallenge = true;
    expect((await bff.session(sessionRequest(cookie))).status).toBe(401);
  });

  it('keeps the session when the issuer cannot be reached (request_failed)', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    await fake.close();
    fake.close = () => Promise.resolve();
    const down = await bff.session(sessionRequest(cookie));
    expect(down.status).toBe(503);
    expect(down.headers.getSetCookie()).toHaveLength(0);
  });

  it('keeps the session for any other error code, not only the ones it knows', async () => {
    for (const error of ['invalid_request', 'invalid_scope', 'unauthorized_client', 'made_up']) {
      const bff = makeBff(fake, clock);
      const { cookie } = await signIn(bff, fake);
      clock.now += 890_000;
      fake.tokenError = { error };
      const response = await bff.session(sessionRequest(cookie));
      expect(response.status).toBe(503);
      fake.tokenError = undefined;
      clock.now = START;
    }
  });

  it('a logout during a delayed refresh is not undone by the refresh', async () => {
    const memory = createMemoryStore({ now: () => clock.now });
    const bff = makeBff(fake, clock, { store: memory });
    const { cookie } = await signIn(bff, fake);
    clock.now += 890_000;
    fake.refreshDelayMs = 80;
    const refreshing = bff.session(sessionRequest(cookie));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const out = await bff.logout(post('/auth/logout', cookie, csrfHeaders));
    expect(out.status).toBe(200);
    const result = await refreshing;
    expect(await result.json()).toEqual({ authenticated: false });
    fake.refreshDelayMs = 0;
    const after = await bff.session(sessionRequest(cookie));
    expect(await after.json()).toEqual({ authenticated: false });
    const id = cookie.split('=')[1] ?? '';
    expect(await memory.get(`session:${id}`)).toBeUndefined();
  });
});

describe('session ids', () => {
  function spy(): { store: SessionStore; keys: string[] } {
    const inner = createMemoryStore({ now: () => clock.now });
    const keys: string[] = [];
    return {
      keys,
      store: {
        get: (id) => inner.get(id),
        delete: (id) => inner.delete(id),
        set: (id, value, ttl) => {
          keys.push(id);
          return inner.set(id, value, ttl);
        },
      },
    };
  }

  it('a sign-in makes a session id that is not the login id', async () => {
    const { store, keys } = spy();
    const { cookie, login } = await signIn(makeBff(fake, clock, { store }), fake);
    const loginId = cookieSet(login, '__Host-odudu-login') ?? 'none';
    const sessionId = cookie.split('=')[1] ?? '';
    expect(sessionId).not.toBe(loginId);
    expect(keys).toContain(`login:${loginId}`);
    expect(keys).toContain(`session:${sessionId}`);
    expect(keys).not.toContain(`session:${loginId}`);
  });

  it('a callback that carried a session drops it', async () => {
    const memory = createMemoryStore({ now: () => clock.now });
    const bff = makeBff(fake, clock, { store: memory });
    const first = await signIn(bff, fake);
    const login = await bff.login(request('/auth/login', first.cookie));
    const authorize = new URL(login.headers.get('location') ?? '');
    fake.claims = { nonce: authorize.searchParams.get('nonce') };
    const params = new URLSearchParams({
      code: 'c',
      state: authorize.searchParams.get('state') ?? '',
      iss: fake.issuer,
    });
    const callback = await bff.callback(
      request(
        `/auth/callback?${params.toString()}`,
        `${first.cookie}; __Host-odudu-login=${cookieSet(login, '__Host-odudu-login') ?? ''}`,
      ),
    );
    expect(callback.status).toBe(302);
    const oldId = first.cookie.split('=')[1] ?? '';
    expect(await memory.get(`session:${oldId}`)).toBeUndefined();
  });
});

describe('logout', () => {
  it('answers 405 with allow: POST to a GET', async () => {
    const response = await makeBff(fake, clock).logout(request('/auth/logout', undefined));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  describe('[RFC10017-6.1.3.3-01] CSRF', () => {
    it('a POST to logout without the X-Odudu-BFF header answers 403', async () => {
      const bff = makeBff(fake, clock);
      const { cookie } = await signIn(bff, fake);
      const response = await bff.logout(post('/auth/logout', cookie, { origin: ORIGIN }));
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('');
      const still = await bff.session(sessionRequest(cookie));
      expect(((await still.json()) as { authenticated: boolean }).authenticated).toBe(true);
    });

    it('a POST to logout with a wrong Origin answers 403', async () => {
      const bff = makeBff(fake, clock);
      const { cookie } = await signIn(bff, fake);
      const response = await bff.logout(
        post('/auth/logout', cookie, { 'x-odudu-bff': '1', origin: 'https://evil.example' }),
      );
      expect(response.status).toBe(403);
    });

    it('a POST to logout with no Origin or an empty header answers 403', async () => {
      const bff = makeBff(fake, clock);
      expect(
        (await bff.logout(post('/auth/logout', undefined, { 'x-odudu-bff': '1' }))).status,
      ).toBe(403);
      expect(
        (await bff.logout(post('/auth/logout', undefined, { 'x-odudu-bff': '', origin: ORIGIN })))
          .status,
      ).toBe(403);
    });

    it('allowedOrigins replaces the origin of the redirect address', async () => {
      const bff = makeBff(fake, clock, { allowedOrigins: ['https://spa.example'] });
      const refused = await bff.logout(post('/auth/logout', undefined, csrfHeaders));
      const allowed = await bff.logout(
        post('/auth/logout', undefined, { 'x-odudu-bff': '1', origin: 'https://spa.example' }),
      );
      expect(refused.status).toBe(403);
      expect(allowed.status).toBe(204);
    });
  });

  it('deletes the session, clears the cookie and answers the issuer logout address', async () => {
    const bff = makeBff(fake, clock, { postLogoutRedirectUri: 'https://app.example/' });
    const { cookie } = await signIn(bff, fake);
    const response = await bff.logout(post('/auth/logout', cookie, csrfHeaders));
    expect(response.status).toBe(200);
    const raw = await response.text();
    const { redirectTo } = JSON.parse(raw) as { redirectTo: string };
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe(`${fake.issuer}/logout`);
    expect(url.searchParams.get('client_id')).toBe('web1');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example/');
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(`${raw} ${[...response.headers].join(' ')}`).not.toMatch(JWT_SHAPED);
    expect(setCookieLine(response, '__Host-odudu')).toContain('Max-Age=0');
    const after = await bff.session(sessionRequest(cookie));
    expect(await after.json()).toEqual({ authenticated: false });
  });

  it('answers the logout address without a redirect when none is configured', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    const response = await bff.logout(post('/auth/logout', cookie, csrfHeaders));
    const url = new URL(((await response.json()) as { redirectTo: string }).redirectTo);
    expect(url.searchParams.get('client_id')).toBe('web1');
    expect(url.searchParams.has('post_logout_redirect_uri')).toBe(false);
  });

  it('is idempotent when there is no session', async () => {
    const bff = makeBff(fake, clock);
    const response = await bff.logout(post('/auth/logout', undefined, csrfHeaders));
    expect(response.status).toBe(204);
    expect(setCookieLine(response, '__Host-odudu')).toContain('Max-Age=0');
    const again = await bff.logout(post('/auth/logout', undefined, csrfHeaders));
    expect(again.status).toBe(204);
  });
});

describe('[RFC10017-6.1.3.1-01] confidential client', () => {
  it('authenticates the code exchange with client_secret_basic', async () => {
    await signIn(makeBff(fake, clock), fake);
    expect(fake.tokenAuthorizations[0]).toMatch(/^Basic /u);
  });
});

describe('[RFC10017-6.1.3.1-02] authorization code grant', () => {
  it('exchanges a code with its PKCE verifier and asks for nothing else', async () => {
    await signIn(makeBff(fake, clock), fake);
    const form = fake.tokenRequests[0];
    expect(form?.get('grant_type')).toBe('authorization_code');
    expect(form?.get('code_verifier')).toMatch(/\S{43,}/u);
  });
});

describe('[RFC10017-6.1.3.2-01] the Secure flag', () => {
  it('is on the session cookie and the login cookie', async () => {
    const { login, callback } = await signIn(makeBff(fake, clock), fake);
    expect(setCookieLine(login, '__Host-odudu-login')).toContain('; Secure');
    expect(setCookieLine(callback, '__Host-odudu')).toContain('; Secure');
  });
});

describe('[RFC10017-6.1.3.2-02] the HttpOnly flag', () => {
  it('is on the session cookie and the login cookie', async () => {
    const { login, callback } = await signIn(makeBff(fake, clock), fake);
    expect(setCookieLine(login, '__Host-odudu-login')).toContain('; HttpOnly');
    expect(setCookieLine(callback, '__Host-odudu')).toContain('; HttpOnly');
  });
});

describe('[RFC10017-6.1.3.2-05] the cookie path', () => {
  it('is / and no Domain is set', async () => {
    const { callback } = await signIn(makeBff(fake, clock), fake);
    const line = setCookieLine(callback, '__Host-odudu');
    expect(line).toContain('Path=/');
    expect(line).not.toContain('Domain');
  });
});

describe('configuration', () => {
  it('refuses a cookie name without the __Host- prefix', () => {
    expect(() => makeBff(fake, clock, { cookieName: 'odudu' })).toThrow(TypeError);
  });

  it('refuses an afterSignInPath that leaves the origin', () => {
    expect(() => makeBff(fake, clock, { afterSignInPath: '//evil.example' })).toThrow(TypeError);
    expect(() => makeBff(fake, clock, { afterSignInPath: 'https://evil.example' })).toThrow(
      TypeError,
    );
    for (const path of ['/\\evil.example', '/a\nb', '/a\u0000b', '/a\u007fb']) {
      expect(() => makeBff(fake, clock, { afterSignInPath: path })).toThrow(TypeError);
    }
  });

  it('uses another cookie name for both cookies', async () => {
    const bff = makeBff(fake, clock, { cookieName: '__Host-shop' });
    const { cookie, login } = await signIn(bff, fake, '__Host-shop');
    expect(cookieSet(login, '__Host-shop-login')).toBeDefined();
    const response = await bff.session(sessionRequest(cookie));
    expect(((await response.json()) as { authenticated: boolean }).authenticated).toBe(true);
  });

  it('keeps login records out of the session store of its own making', async () => {
    const bff = makeBff(fake, clock);
    const { cookie } = await signIn(bff, fake);
    for (let i = 0; i < 12_000; i += 1) await bff.login(request('/auth/login', undefined));
    const response = await bff.session(sessionRequest(cookie));
    expect(((await response.json()) as { authenticated: boolean }).authenticated).toBe(true);
  }, 60_000);
});
