import { type Config } from '@odudu/kernel';
import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';

// Allowlist, not denylist: a denylist only redacts headers someone thought
// to name. At P1 this log line also carries OIDC `/authorize` query strings
// (state, code_challenge, login_hint, id_token_hint, code) and any
// credential-bearing header nobody has named yet (proxy-authorization,
// x-api-key, later dpop). Everything not named here is dropped, not merely
// censored — an unrecognized header cannot leak by omission from this list.
const ALLOWED_REQUEST_HEADERS = new Set([
  'host',
  'user-agent',
  'accept',
  'accept-language',
  'accept-encoding',
  'content-type',
  'content-length',
  'x-request-id',
]);

// The response half of the same rule. `location` is allowed but never
// emitted whole — it is a URL, so it is cut down below. `set-cookie` is
// absent rather than censored: a name off this list cannot be logged at all.
const ALLOWED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'pragma',
  'retry-after',
  'www-authenticate',
  'accept-post',
  'vary',
  'x-request-id',
  // The only member of its family worth logging: cors.ts sends `vary: Origin`
  // on the refused branch too, so its absence is the one trace of a refusal.
  'access-control-allow-origin',
  'location',
]);

function allowlistedHeaders(
  headers: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (allowed.has(name.toLowerCase())) {
      result[name] = value;
    }
  }
  return result;
}

// Two patterns because `//u:p@host/x` is an authority in a Location
// (RFC 3986 §4.2) and a path in a request URL, which is origin-relative.
const REQUEST_USERINFO = /^([a-zA-Z][a-zA-Z\d+.-]*:\/\/)[^/]*@/;
const LOCATION_USERINFO = /^([a-zA-Z][a-zA-Z\d+.-]*:\/\/|\/\/)[^/]*@/;

// Query strings carry the same class of secrets as headers (OAuth `code`,
// `state`, `code_challenge`, ...) and a two-entry denylist has already once
// missed something. Logging the path only is the allowlist equivalent for a
// URL: nothing after `?` or `#`, and nothing between `//` and `@`. A
// registered redirect_uri may carry userinfo, and `response_mode=fragment`
// puts the code after the hash.
function pathOnly(url: string, userinfo: RegExp): string {
  const cut = url.search(/[?#]/);
  return (cut === -1 ? url : url.slice(0, cut)).replace(userinfo, '$1');
}

// A shape nothing here recognizes is dropped, never passed through: that is
// the same rule the header allowlist follows, applied to a value.
function loggedUrl(value: unknown, userinfo: RegExp): unknown {
  if (typeof value === 'string') return pathOnly(value, userinfo);
  if (!Array.isArray(value)) return undefined;
  const members = value as readonly unknown[];
  return members.flatMap((member) =>
    typeof member === 'string' ? [pathOnly(member, userinfo)] : [],
  );
}

function responseHeaders(headers: unknown): Record<string, unknown> {
  const allowlisted = allowlistedHeaders(
    typeof headers === 'object' && headers !== null ? (headers as Record<string, unknown>) : {},
    ALLOWED_RESPONSE_HEADERS,
  );
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(allowlisted)) {
    const logged = name.toLowerCase() === 'location' ? loggedUrl(value, LOCATION_USERINFO) : value;
    if (logged !== undefined) result[name] = logged;
  }
  return result;
}

export function createLogger(config: Config, destination?: DestinationStream): PinoLogger {
  return pino(
    {
      level: config.ODUDU_LOG_LEVEL,
      serializers: {
        req: (request: { method: string; url: unknown; headers: unknown; id: string }) => ({
          id: request.id,
          method: request.method,
          url: loggedUrl(request.url, REQUEST_USERINFO),
          headers: allowlistedHeaders(
            (request.headers ?? {}) as Record<string, unknown>,
            ALLOWED_REQUEST_HEADERS,
          ),
        }),
        res: (reply: { statusCode: number; getHeaders: () => unknown }) => ({
          statusCode: reply.statusCode,
          headers: responseHeaders(reply.getHeaders()),
        }),
      },
    },
    destination,
  );
}
