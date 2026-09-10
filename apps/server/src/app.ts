import { type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger as PinoLogger } from 'pino';
import { registerHealth } from '#/health.js';

export interface AppDeps {
  readonly database: DatabaseHandle;
  readonly logger: PinoLogger;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify<RawServerDefault, IncomingMessage, ServerResponse>({
    loggerInstance: deps.logger,
    genReqId: () => newId(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerHealth(app, deps);

  return app;
}
