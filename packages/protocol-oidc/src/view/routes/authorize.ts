import { type FastifyInstance } from 'fastify';
import {
  handleAuthorizationRequest,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';

export function registerAuthorizeRoute(app: FastifyInstance, deps: AuthorizeUsecaseDeps): void {
  app.get<{ Params: { realm: string }; Querystring: Record<string, string | undefined> }>(
    '/realms/:realm/protocol/openid-connect/auth',
    async (request, reply) => {
      const outcome = await handleAuthorizationRequest(deps, request.params.realm, request.query);

      if (outcome.kind === 'render') {
        return reply
          .code(400)
          .type('text/html')
          .send(renderAuthorizeErrorPage(outcome.error, outcome.description));
      }

      if (outcome.kind === 'redirect') {
        const target = new URL(outcome.redirectUri);
        target.searchParams.set('error', outcome.error);
        if (outcome.state !== null) target.searchParams.set('state', outcome.state);
        return reply.code(302).header('location', target.toString()).send();
      }

      return reply
        .code(200)
        .type('text/html')
        .send(renderLoginForm(request.params.realm, outcome.authSessionId));
    },
  );
}
