import { type FastifyInstance } from 'fastify';
import { resolveDiscoveryDocument, type DiscoveryUsecaseDeps } from '#/usecase/discovery';
import { issuerBaseFor } from '#/view/issuer';

export function registerDiscoveryRoute(app: FastifyInstance, deps: DiscoveryUsecaseDeps): void {
  app.get<{ Params: { tenant: string } }>(
    '/tenants/:tenant/.well-known/openid-configuration',
    async (request, reply) => {
      // A public, unauthenticated document: every origin may read it, and
      // with a fixed wildcard there is nothing to vary the response on.
      reply.header('access-control-allow-origin', '*');
      const doc = await resolveDiscoveryDocument(
        deps,
        request.params.tenant,
        issuerBaseFor(request),
      );
      if (doc === null) return reply.code(404).send();
      return doc;
    },
  );
}
