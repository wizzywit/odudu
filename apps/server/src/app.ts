import { type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger as PinoLogger } from 'pino';
import { registerHealth } from '#/health';

export interface AppDeps {
  readonly database: DatabaseHandle;
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

  registerHealth(app, deps);

  return app;
}
