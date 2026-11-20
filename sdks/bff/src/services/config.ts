import type { ClientAuth } from '@odudu-io/oidc';
import type { BffOptions } from '#/types';

export interface BffConfig extends BffOptions {
  cookieName: string;
  loginCookieName: string;
  allowedOrigins: string[];
  afterSignInPath: string;
  sessionTtlMs: number;
}

export const DEFAULT_COOKIE_NAME = '__Host-odudu';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The options with their defaults applied, or a TypeError for one that would
// weaken the cookie or leave the CSRF check with nothing to compare.
export function resolveConfig(options: BffOptions): BffConfig {
  const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
  if (!cookieName.startsWith('__Host-')) {
    throw new TypeError('cookieName must start with __Host-');
  }
  const afterSignInPath = options.afterSignInPath ?? '/';
  if (!isLocalPath(afterSignInPath)) {
    throw new TypeError('afterSignInPath must be a path on this origin');
  }
  return {
    ...options,
    cookieName,
    loginCookieName: `${cookieName}-login`,
    allowedOrigins: options.allowedOrigins ?? [new URL(options.redirectUri).origin],
    afterSignInPath,
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
  };
}

// The core's client authentication for the options, none for a public client.
export function authOf(config: BffConfig): { auth: ClientAuth } | Record<string, never> {
  return config.clientSecret === undefined ? {} : { auth: { secret: config.clientSecret } };
}

// The address the core compares against the redirect URI: the registered
// address with the query the issuer sent. The request's own address is not
// used, because behind a proxy it names an internal host.
export function callbackUrlOf(redirectUri: string, requestUrl: string): string {
  const url = new URL(redirectUri);
  url.search = new URL(requestUrl).search;
  return url.href;
}

// A path on this origin: it starts with one slash, and has no backslash, which
// browsers read as a slash, and no control character.
function isLocalPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

// The RP-initiated logout address. It names the client and not an ID token:
// the token never leaves the server, and the issuer, which then has no hint to
// skip its confirmation page for, asks the person to confirm and honours a
// registered `post_logout_redirect_uri` after they do.
export function logoutAddressOf(
  endpoint: string,
  clientId: string,
  postLogoutRedirectUri: string | undefined,
): string {
  const url = new URL(endpoint);
  url.searchParams.set('client_id', clientId);
  if (postLogoutRedirectUri !== undefined) {
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  }
  return url.href;
}
