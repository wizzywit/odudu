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

function allowlistedHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (ALLOWED_REQUEST_HEADERS.has(name.toLowerCase())) {
      result[name] = value;
    }
  }
  return result;
}

// Query strings carry the same class of secrets as headers (OAuth `code`,
// `state`, `code_challenge`, ...) and a two-entry denylist has already once
// missed something. Logging the path only is the allowlist equivalent for a
// URL: nothing after `?` is ever emitted.
function pathOnly(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export function createLogger(config: Config, destination?: DestinationStream): PinoLogger {
  return pino(
    {
      level: config.ODUDU_LOG_LEVEL,
      redact: {
        paths: ['res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      serializers: {
        req: (request: { method: string; url: string; headers: unknown; id: string }) => ({
          id: request.id,
          method: request.method,
          url: pathOnly(request.url),
          headers: allowlistedHeaders((request.headers ?? {}) as Record<string, unknown>),
        }),
        res: (reply: { statusCode: number; getHeaders: () => unknown }) => ({
          statusCode: reply.statusCode,
          headers: reply.getHeaders(),
        }),
      },
    },
    destination,
  );
}
