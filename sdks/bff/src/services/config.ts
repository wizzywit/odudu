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
  if (!afterSignInPath.startsWith('/') || afterSignInPath.startsWith('//')) {
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
