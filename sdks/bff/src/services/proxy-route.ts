import { proxyGate } from '#/services/gate';
import type { Upstream } from '#/types';

export const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export type Route =
  | { kind: 'target'; upstream: Upstream; url: string }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'method-not-allowed'; allow: string };

// Escapes that name a character this check exists to keep out of a path:
// a dot, a slash, a backslash, a percent sign (a second decoding would turn
// `%252e` into a dot) and NUL.
const FORBIDDEN_ESCAPES = new Set(['2e', '2f', '5c', '25', '00']);

function escapesAreSafe(path: string): boolean {
  for (let i = path.indexOf('%'); i !== -1; i = path.indexOf('%', i + 1)) {
    const hex = path.slice(i + 1, i + 3);
    if (!/^[0-9a-fA-F]{2}$/u.test(hex) || FORBIDDEN_ESCAPES.has(hex.toLowerCase())) return false;
  }
  return true;
}

// Printable ASCII only, and no backslash, which a server may read as a slash,
// and no semicolon, which starts a path parameter some servers strip, `..;/`
// among them.
function charactersAreSafe(path: string): boolean {
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f || code === 0x5c || code === 0x3b) return false;
  }
  return true;
}

function segmentsAreSafe(path: string): boolean {
  const segments = path.split('/').slice(1);
  return segments.every(
    (segment, index) =>
      segment !== '.' && segment !== '..' && (segment !== '' || index === segments.length - 1),
  );
}

// A path that names one place whatever decodes it: it starts with one slash,
// has no dot segment and no empty segment, and no escape that could hide one.
export function isCleanPath(path: string): boolean {
  return (
    path.startsWith('/') && charactersAreSafe(path) && escapesAreSafe(path) && segmentsAreSafe(path)
  );
}

// A prefix covers itself and what lies below it, on whole segments: `/v1`
// covers `/v1` and `/v1/a`, not `/v10`.
function underPrefix(path: string, prefix: string): boolean {
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return path === prefix || path.startsWith(base);
}

// What follows the mount path, starting with a slash, or undefined for any
// other path.
export function restOfPath(pathname: string, proxyPath: string): string | undefined {
  return pathname.startsWith(`${proxyPath}/`) ? pathname.slice(proxyPath.length) : undefined;
}

// Decides where a proxied request goes, from `/<name>/<path>` after the mount
// path. The path is checked as it will be sent, so nothing is decoded or
// resolved between the check and the call; the target is `origin + path`, the
// origin comes only from the configuration, and the result is checked to still
// name that origin.
export function routeProxy(
  upstreams: Upstream[],
  rest: string,
  search: string,
  method: string,
): Route {
  const [, name = '', ...tail] = rest.split('/');
  const upstream = upstreams.find((candidate) => candidate.name === name);
  if (upstream === undefined) return { kind: 'not-found' };
  const path = tail.length === 0 ? '/' : `/${tail.join('/')}`;
  if (!isCleanPath(path) || !upstream.pathPrefixes.some((prefix) => underPrefix(path, prefix))) {
    return { kind: 'forbidden' };
  }
  const methods = upstream.methods ?? DEFAULT_METHODS;
  if (!methods.includes(method)) return { kind: 'method-not-allowed', allow: methods.join(', ') };
  const url = `${upstream.origin}${path}${search}`;
  return new URL(url).origin === upstream.origin
    ? { kind: 'target', upstream, url }
    : { kind: 'forbidden' };
}

export interface ProxyRequest {
  method: string;
  customHeader: string | null;
  origin: string | null;
  pathname: string;
  search: string;
}

export interface ProxyRules {
  upstreams: Upstream[];
  proxyPath: string;
  allowedOrigins: string[];
}

// The gate, then the route: a request that fails the gate never learns which
// upstreams exist.
export function planProxy(request: ProxyRequest, rules: ProxyRules): Route {
  const verdict = proxyGate({
    method: request.method,
    customHeader: request.customHeader,
    origin: request.origin,
    allowedOrigins: rules.allowedOrigins,
  });
  if (verdict === 'forbidden') return { kind: 'forbidden' };
  const rest = restOfPath(request.pathname, rules.proxyPath);
  if (rest === undefined) return { kind: 'not-found' };
  return routeProxy(rules.upstreams, rest, request.search, request.method);
}
