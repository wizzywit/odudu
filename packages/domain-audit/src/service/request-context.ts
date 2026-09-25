import { type RequestContext } from '@odudu/db';

export type { RequestContext } from '@odudu/db';

const REQUEST_ID_MAX_LENGTH = 128;

/**
 * `ip` comes from `request.ip` alone, never a header: Fastify's own
 * `trustProxy` option is the one place that decides whether a proxy header
 * is the client's address, and reading one here a second time would let a
 * caller override that decision per request.
 */
export function requestContextFrom(request: {
  readonly id: string;
  readonly ip: string;
}): RequestContext {
  return {
    requestId: request.id.slice(0, REQUEST_ID_MAX_LENGTH),
    ip: request.ip,
  };
}
