import { type FastifyInstance } from 'fastify';
import { resolveUserinfo, type UserinfoDeps } from '#/usecase/userinfo';
import { realmIssuerFor } from '#/view/issuer';

export function registerUserinfoRoute(app: FastifyInstance, deps: UserinfoDeps): void {
  app.get<{ Params: { realm: string } }>(
    '/realms/:realm/protocol/openid-connect/userinfo',
    async (request, reply) => {
      const issuer = realmIssuerFor(request, request.params.realm);
      const outcome = await resolveUserinfo(
        deps,
        request.params.realm,
        issuer,
        request.headers.authorization,
      );

      switch (outcome.kind) {
        case 'not_found':
          return reply.code(404).send();
        case 'missing_credentials':
          return reply.code(401).header('www-authenticate', 'Bearer realm="userinfo"').send();
        case 'invalid_token':
          return reply
            .code(401)
            .header('www-authenticate', 'Bearer realm="userinfo", error="invalid_token"')
            .send();
        case 'insufficient_scope':
          return reply
            .code(403)
            .header('www-authenticate', 'Bearer realm="userinfo", error="insufficient_scope"')
            .send();
        case 'ok':
          return reply.code(200).send(outcome.claims);
      }
    },
  );
}
