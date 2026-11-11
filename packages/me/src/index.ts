import type { FastifyInstance } from 'fastify';
import type { ValidateMeTokenDeps } from '#/usecase/validate-me-token';

export {
  validateMeToken,
  type MeAuthOutcome,
  type ValidateMeTokenDeps,
  type ValidateMeTokenInput,
} from '#/usecase/validate-me-token';

// What the server hands the "me" API once per process. Routes add to it.
export type MeDeps = ValidateMeTokenDeps;

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  app.log.debug({ door: typeof deps.verifyAccessToken }, 'me routes registered');
}
