import { type DatabaseHandle } from '@odudu/db';
import { type FastifyInstance } from 'fastify';

export function registerHealth(app: FastifyInstance, deps: { database: DatabaseHandle }): void {
  app.get('/health/live', () => ({ status: 'ok' }));

  app.get('/health/ready', async (request, reply) => {
    try {
      await deps.database.sql`select 1`;
      return { status: 'ok', checks: { database: 'ok' } };
    } catch (error) {
      request.log.warn({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable', checks: { database: 'failed' } });
    }
  });
}
