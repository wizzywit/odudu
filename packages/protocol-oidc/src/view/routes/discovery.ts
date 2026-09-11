import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { resolveDiscoveryDocument, type DiscoveryUsecaseDeps } from '#/usecase/discovery';

// Fastify's request.protocol/hostname respect trustProxy the same way
// request.ip does (apps/server/src/app.ts): behind a reverse proxy that
// terminates TLS, ODUDU_TRUST_PROXY must be on for the issuer to read
// https, exactly as it must be on for request.ip to read the real client.
function issuerBaseFor(request: FastifyRequest): string {
  return `${request.protocol}://${request.hostname}`;
}

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
