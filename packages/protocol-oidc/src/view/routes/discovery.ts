import { type FastifyInstance } from 'fastify';
import { resolveDiscoveryDocument, type DiscoveryUsecaseDeps } from '#/usecase/discovery';
import { issuerBaseFor } from '#/view/issuer';

export function registerDiscoveryRoute(app: FastifyInstance, deps: DiscoveryUsecaseDeps): void {
  app.get<{ Params: { realm: string } }>(
    '/realms/:realm/.well-known/openid-configuration',
    async (request, reply) => {
      const doc = await resolveDiscoveryDocument(
        deps,
        request.params.realm,
        issuerBaseFor(request),
      );
      if (doc === null) return reply.code(404).send();
      return doc;
    },
  );
}
