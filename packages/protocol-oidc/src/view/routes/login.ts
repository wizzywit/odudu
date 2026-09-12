import { sessionCookieName } from '@odudu/authn-flows';
import { type FastifyInstance } from 'fastify';
import { handleLoginSubmission, type LoginSubmissionDeps } from '#/usecase/login-submission';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';
import { issuerBaseFor } from '#/view/issuer';

export interface LoginRouteDeps extends LoginSubmissionDeps {
  tls: boolean;
}

// @fastify/formbody parses a repeated field into an array; every field this
// handler reads is meant to carry exactly one value, so a repeat is treated
// as absent rather than silently picking one.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Deliberately not under /protocol/openid-connect/: that namespace is the
// OIDC wire protocol, and this is Odudu's own login UI, which no
// specification describes and no client library calls.
export function registerLoginRoute(app: FastifyInstance, deps: LoginRouteDeps): void {
  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/authenticate', async (request, reply) => {
    const body = request.body;
    const authSessionId = firstString(body.auth_session_id);
    const username = firstString(body.username);
    const password = firstString(body.password);

    const outcome = await handleLoginSubmission(
      deps,
      request.params.realm,
      issuerBaseFor(request),
      authSessionId,
      {
        ...(username !== undefined ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
      },
    );

    if (outcome.kind === 'unauthenticated') {
      return reply
        .code(400)
        .type('text/html')
        .send(
          renderAuthorizeErrorPage(
            'invalid_request',
            'This sign-in attempt is no longer valid. Go back and start again.',
          ),
        );
    }

    // No set-cookie: nothing was established to carry in one.
    if (outcome.kind === 'error_redirect') {
      return reply.code(302).header('location', outcome.location).send();
    }

    if (outcome.kind === 'reject') {
      return reply
        .code(200)
        .type('text/html')
        .send(renderLoginForm(request.params.realm, outcome.authSessionId));
    }

    const cookieName = sessionCookieName(request.params.realm, deps.tls);
    const cookie = [
      `${cookieName}=${outcome.sessionId}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      ...(deps.tls ? ['Secure'] : []),
    ].join('; ');

    return reply.code(302).header('set-cookie', cookie).header('location', outcome.location).send();
  });
}
