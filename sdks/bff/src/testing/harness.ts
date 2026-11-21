import { createBff } from '#/use-cases/create-bff';
import type { FakeServer } from '#/testing/fake-server';
import type { Bff, BffOptions } from '#/types';

export const REDIRECT = 'https://app.example/auth/callback';
export const ORIGIN = 'https://app.example';
export const START = 1_800_000_000_000;

export interface Clock {
  now: number;
}

export function makeBff(fake: FakeServer, clock: Clock, overrides: Partial<BffOptions> = {}): Bff {
  return createBff({
    issuer: fake.issuer,
    clientId: 'web1',
    clientSecret: 'a-distinctive-secret-7c1f',
    redirectUri: REDIRECT,
    scope: 'openid offline_access',
    deps: { allowInsecureRequests: true, now: () => clock.now },
    ...overrides,
  });
}

// The value of a cookie a response sets, undefined when it is not set.
export function cookieSet(response: Response, name: string): string | undefined {
  const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

export function setCookieLine(response: Response, name: string): string {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
}

export function request(path: string, cookie: string | undefined, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

// Runs login and callback and returns the session cookie header, the login
// response and the callback response.
export async function signIn(
  bff: Bff,
  fake: FakeServer,
  cookieName = '__Host-odudu',
): Promise<{ cookie: string; login: Response; callback: Response }> {
  const login = await bff.login(request('/auth/login', undefined));
  const authorize = new URL(login.headers.get('location') ?? '');
  fake.claims = { nonce: authorize.searchParams.get('nonce') };
  const loginCookie = `${cookieName}-login=${cookieSet(login, `${cookieName}-login`) ?? ''}`;
  const params = new URLSearchParams({
    code: 'code-1',
    state: authorize.searchParams.get('state') ?? '',
    iss: fake.issuer,
  });
  const callback = await bff.callback(
    new Request(`${REDIRECT}?${params.toString()}`, { headers: { cookie: loginCookie } }),
  );
  return { cookie: `${cookieName}=${cookieSet(callback, cookieName) ?? ''}`, login, callback };
}
