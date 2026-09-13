import { type FastifyInstance } from 'fastify';
import { resolveJwks, type JwksUsecaseDeps } from '#/usecase/jwks';

export function registerJwksRoute(app: FastifyInstance, deps: JwksUsecaseDeps): void {
  app.get<{ Params: { realm: string } }>(
    '/realms/:realm/protocol/openid-connect/certs',
    async (request, reply) => {
      const jwks = await resolveJwks(deps, request.params.realm);
      if (jwks === null) return reply.code(404).send();
      return jwks;
    },
  );
}
