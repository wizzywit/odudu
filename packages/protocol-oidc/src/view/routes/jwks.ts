import { type FastifyInstance } from 'fastify';
import { resolveJwks, type JwksUsecaseDeps } from '#/usecase/jwks';

export function registerJwksRoute(app: FastifyInstance, deps: JwksUsecaseDeps): void {
  app.get<{ Params: { tenant: string } }>(
    '/tenants/:tenant/protocol/openid-connect/certs',
    async (request, reply) => {
      // A public, unauthenticated document: every origin may read it, and
      // with a fixed wildcard there is nothing to vary the response on.
      reply.header('access-control-allow-origin', '*');
      const jwks = await resolveJwks(deps, request.params.tenant);
      if (jwks === null) return reply.code(404).send();
      return jwks;
    },
  );
}
