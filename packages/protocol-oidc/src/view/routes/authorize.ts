import { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  handleAuthorizationRequest,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';

const PATH = '/realms/:realm/protocol/openid-connect/auth';

// GET carries parameters in the query string, POST in a form-encoded body
// (OIDC Core §3.1.2 requires the Authorization Endpoint to support both) —
// but everything past "where do the parameters come from" is one shared
// path, so the two methods cannot drift out of agreement with each other.
async function respondToAuthorizationRequest(
  deps: AuthorizeUsecaseDeps,
  realm: string,
  params: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const outcome = await handleAuthorizationRequest(deps, realm, params);

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

  return reply.code(200).type('text/html').send(renderLoginForm(realm, outcome.authSessionId));
}

export function registerAuthorizeRoute(app: FastifyInstance, deps: AuthorizeUsecaseDeps): void {
  app.get<{
    Params: { realm: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>(PATH, (request, reply) =>
    respondToAuthorizationRequest(deps, request.params.realm, request.query, reply),
  );

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>(PATH, (request, reply) =>
    respondToAuthorizationRequest(deps, request.params.realm, request.body, reply),
  );
}
