import { createOduduHandlers, type OduduHandlers, type OduduHandlersOptions } from '#/index';
import type { FakeIssuer } from '#test/fake-issuer';

export const ORIGIN = 'https://app.example';
export const START = 1_800_000_000_000;
export const SESSION_COOKIE = '__Host-odudu';
export const LOGIN_COOKIE = '__Host-odudu-login';
export const RETURN_COOKIE = '__Host-odudu-return';

export interface Clock {
  now: number;
}

export function makeHandlers(
  fake: FakeIssuer,
  clock: Clock,
  overrides: Partial<OduduHandlersOptions> = {},
): OduduHandlers {
  return createOduduHandlers({
    issuer: fake.issuer,
    clientId: 'web1',
    clientSecret: 'a-distinctive-secret-7c1f',
    redirectUri: `${ORIGIN}/api/auth/callback`,
    scope: 'openid offline_access',
    deps: { allowInsecureRequests: true, now: () => clock.now },
    ...overrides,
  });
}

export function route(path: string, init: RequestInit = {}, cookie?: string): Request {
  const headers = new Headers(init.headers);
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

export function cookieSet(response: Response, name: string): string | undefined {
  const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

export interface SignedIn {
  // The `Cookie` request header of the signed-in browser.
  cookie: string;
  login: Response;
  callback: Response;
}

// Runs login and callback through the route handlers, as a browser would.
export async function signIn(
  handlers: OduduHandlers,
  fake: FakeIssuer,
  returnTo?: string,
  cookieName = SESSION_COOKIE,
): Promise<SignedIn> {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const login = await handlers.GET(route(`/api/auth/login${query}`));
  const authorize = new URL(login.headers.get('location') ?? '');
  fake.claims = { nonce: authorize.searchParams.get('nonce'), name: 'Ada Lovelace' };
  const loginCookies = [`${cookieName}-login`, `${cookieName}-return`]
    .map((name) => [name, cookieSet(login, name)] as const)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value ?? ''}`)
    .join('; ');
  const params = new URLSearchParams({
    code: 'code-1',
    state: authorize.searchParams.get('state') ?? '',
    iss: fake.issuer,
  });
  const callback = await handlers.GET(
    route(`/api/auth/callback?${params.toString()}`, {}, loginCookies),
  );
  return { cookie: `${cookieName}=${cookieSet(callback, cookieName) ?? ''}`, login, callback };
}
