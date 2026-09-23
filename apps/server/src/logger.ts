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

// The response half of the same rule, derived from what this server
// actually sends: `pageHeaders` in @odudu/kernel, the cache and challenge
// headers of the token, introspection, revocation and userinfo endpoints,
// and app.ts's request id. `location` is allowed but never emitted whole —
// it is a URL, so it gets the URL treatment below. `set-cookie` is absent
// rather than censored: a name not on this list cannot be logged at all,
// which is what a redaction entry was standing in for.
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

// Query strings carry the same class of secrets as headers (OAuth `code`,
// `state`, `code_challenge`, ...) and a two-entry denylist has already once
// missed something. Logging the path only is the allowlist equivalent for a
// URL: nothing after `?` or `#` is ever emitted — response_mode=fragment
// puts the authorization code after the `#`.
function pathOnly(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function responseHeaders(headers: unknown): Record<string, unknown> {
  const allowlisted = allowlistedHeaders(
    typeof headers === 'object' && headers !== null ? (headers as Record<string, unknown>) : {},
    ALLOWED_RESPONSE_HEADERS,
  );
  for (const [name, value] of Object.entries(allowlisted)) {
    if (name.toLowerCase() === 'location') allowlisted[name] = pathOnly(value);
  }
  return allowlisted;
}

export function createLogger(config: Config, destination?: DestinationStream): PinoLogger {
  return pino(
    {
      level: config.ODUDU_LOG_LEVEL,
      serializers: {
        req: (request: { method: string; url: string; headers: unknown; id: string }) => ({
          id: request.id,
          method: request.method,
          url: pathOnly(request.url),
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
