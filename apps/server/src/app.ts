import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { oidcRoutes } from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger as PinoLogger } from 'pino';
import { registerHealth } from '#/health';

export interface AppDeps {
  readonly database: DatabaseHandle;
  /**
   * The owner (RLS-bypassing) connection — see
   * `@odudu/protocol-oidc`'s realm-lookup repository for the one thing it is
   * used for: resolving `{realm}` from a request path to an id and an
   * enabled flag before any realm context exists to scope that lookup by.
   * Required, not defaulted: on the RLS-constrained connection this lookup
   * returns zero rows unconditionally (`realms_isolation` keys on `id`,
   * with no realm context set yet), which 404s every realm forever —
   * indistinguishable from "no realms configured" unless a caller is
   * forced to supply this explicitly. Callers that genuinely want the
   * owner/runtime connection to be the same one (e.g. local dev without
   * `ODUDU_APP_DATABASE_URL`, as in `main.ts`) pass `database` again here.
   */
  readonly ownerDatabase: DatabaseHandle;
  readonly logger: PinoLogger;
  /**
   * Whether to trust `X-Forwarded-*` headers when deriving `request.ip`.
   * Defaults to `false`: with no reverse proxy in front of the server,
   * those headers are client-controlled, and `request.ip` will later feed
   * rate limiting, brute-force lockout, and audit records.
   */
  readonly trustProxy?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify<RawServerDefault, IncomingMessage, ServerResponse>({
    loggerInstance: deps.logger,
    genReqId: () => newId(),
    requestIdHeader: 'x-request-id',
    trustProxy: deps.trustProxy ?? false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Registered here rather than by a route: the token endpoint needs
  // form-encoded bodies and the authorization endpoint needs the session
  // cookie, and plugin registration is an app-wide concern.
  app.register(formbody);
  app.register(cookie);

  registerHealth(app, deps);
  app.register(oidcRoutes({ database: deps.database, ownerDatabase: deps.ownerDatabase }));

  return app;
}
