import { corsHeadersForRequest } from '@odudu/protocol-oidc';

// What a script on an allowed origin may read of the answer beyond the headers
// every response shows: the RFC 9470 challenge a gated change is refused with,
// and how long to wait after a `429`.
const EXPOSED = 'WWW-Authenticate, Retry-After';

// The headers of a real answer to a request that names an origin: the origin
// echoed when `allowed` holds it, with the two a script needs, and `Vary` always.
export function meAnswerHeaders(
  origin: string,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const headers = corsHeadersForRequest(origin, allowed);
  return headers['access-control-allow-origin'] === undefined
    ? headers
    : { ...headers, 'access-control-expose-headers': EXPOSED };
}

// The answer a browser's preflight gets for an origin some client of the
// tenant allows. The real request is judged against its own client instead,
// in the route.
export function mePreflightHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
