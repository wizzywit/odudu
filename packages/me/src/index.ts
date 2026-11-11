import type { FastifyInstance } from 'fastify';

export type MeDeps = Record<string, never>;

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  app.log.debug({ deps: Object.keys(deps).length }, 'me routes registered');
}
