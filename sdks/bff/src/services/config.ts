import type { ClientAuth } from '@odudu-io/oidc';
import { DEFAULT_METHODS, isCleanPath } from '#/services/proxy-route';
import type { BffOptions, Upstream } from '#/types';

export interface BffConfig extends BffOptions {
  cookieName: string;
  loginCookieName: string;
  allowedOrigins: string[];
  afterSignInPath: string;
  sessionTtlMs: number;
  upstreams: Upstream[];
  proxyPath: string;
  mountPath: string;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
}

export const DEFAULT_COOKIE_NAME = '__Host-odudu';
// The header a read of the session, a sign-out and the proxy must carry.
export const BFF_HEADER = 'x-odudu-bff';
// Set by the BFF on its own 401 when the session is over. The proxy removes it
// from every upstream answer, so an API's 401 can never carry it.
export const SESSION_HEADER = 'x-odudu-session';
export const SESSION_ENDED = 'ended';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PROXY_PATH = '/proxy';
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;

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
  const mountPath = checkPrefix(options.mountPath ?? '', 'mountPath');
  return {
    ...options,
    mountPath,
    cookieName,
    loginCookieName: `${cookieName}-login`,
    allowedOrigins: options.allowedOrigins ?? [new URL(options.redirectUri).origin],
    afterSignInPath,
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    upstreams: checkUpstreams(options.upstreams ?? []),
    proxyPath: checkProxyPath(options.proxyPath ?? `${mountPath}${DEFAULT_PROXY_PATH}`),
    maxBodyBytes: positiveInteger(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes'),
    upstreamTimeoutMs: positiveInteger(
      options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
      'upstreamTimeoutMs',
    ),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive whole number`);
  }
  return value;
}

function checkProxyPath(path: string): string {
  if (path === '/') throw new TypeError('proxyPath must be below the root');
  return checkPrefix(path, 'proxyPath');
}

// A mount path the browser can use as it stands: it starts with a slash, ends
// without one, and holds only unreserved characters and slashes, so nothing
// in it needs an escape or can be read as a dot segment. Empty is no prefix.
export function checkPrefix(path: string, name = 'prefix'): string {
  if (path === '') return path;
  if (!/^\/[A-Za-z0-9/_.~-]*$/u.test(path) || path.endsWith('/') || !isCleanPath(path)) {
    throw new TypeError(
      `${name} must start with / and not end with one, with only A-Z a-z 0-9 / _ . ~ - in it`,
    );
  }
  return path;
}

// An upstream is an exact origin the app names; a mistake here would widen what
// the proxy reaches, so each part is checked and a bad one stops the start.
function checkUpstreams(upstreams: Upstream[]): Upstream[] {
  const names = new Set<string>();
  return upstreams.map((upstream) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(upstream.name) || names.has(upstream.name)) {
      throw new TypeError(`upstream name "${upstream.name}" is empty, malformed or used twice`);
    }
    names.add(upstream.name);
    checkOrigin(upstream);
    for (const prefix of upstream.pathPrefixes) {
      if (!isCleanPath(prefix)) {
        throw new TypeError(`upstream ${upstream.name}: "${prefix}" is not a clean path prefix`);
      }
    }
    return { ...upstream, methods: checkMethods(upstream) };
  });
}

function checkOrigin(upstream: Upstream): void {
  const parsed = URL.canParse(upstream.origin) ? new URL(upstream.origin) : undefined;
  if (
    parsed === undefined ||
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.origin !== upstream.origin
  ) {
    throw new TypeError(
      `upstream ${upstream.name}: origin must be an http(s) origin with no path, as ${parsed?.origin ?? 'https://host'}`,
    );
  }
}

function checkMethods(upstream: Upstream): string[] {
  const methods = (upstream.methods ?? DEFAULT_METHODS).map((method) => method.toUpperCase());
  if (methods.length === 0 || methods.some((method) => !/^[A-Z]+$/u.test(method))) {
    throw new TypeError(`upstream ${upstream.name}: methods must be a non-empty list of names`);
  }
  return methods;
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
export function isLocalPath(path: string): boolean {
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
  allowInsecure: boolean,
): string {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new TypeError('the end_session_endpoint is not an https address');
  }
  url.searchParams.set('client_id', clientId);
  if (postLogoutRedirectUri !== undefined) {
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  }
  return url.href;
}

// A path to mount the BFF's routes on, as a framework binding takes it.
export function checkMountPath(path: string): string {
  return checkPrefix(path, 'mountPath');
}
