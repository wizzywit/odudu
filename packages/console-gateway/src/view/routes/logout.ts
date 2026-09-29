import { type FastifyInstance } from 'fastify';
import { STATUS_CODES } from 'node:http';
import { clearedSessionCookie } from '#/service/cookies';
import { logout, type LogoutDeps } from '#/usecase/logout';
import { BAD_GATEWAY, sendProblem } from '#/view/problem';
import { answerErrors, callerOf } from '#/view/scope';

export interface LogoutRouteDeps extends LogoutDeps {
  readonly now: () => Date;
}

// A JSON body rather than a 302: the CSRF guard needs a custom header, so
// this is a fetch, and a fetch that follows a redirect cannot move the page.
// The SPA navigates to the answer itself. Its own scope, so a failure is
// answered as the fetch expects rather than as the sign-in's page.
export function registerLogoutRoute(fastify: FastifyInstance, deps: LogoutRouteDeps): void {
  fastify.register((scope) => {
    // A failure leaves the session whole (the logout usecase), so its
    // cookie stays too and the logout can be retried.
    answerErrors(scope, 'console logout failed', (request, reply, status) =>
      sendProblem(reply, request, {
        status,
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Bad Request',
      }),
    );

    scope.post('/logout', async (request, reply) => {
      const result = await logout(deps, {
        cookieHeader: request.headers.cookie,
        from: callerOf(request),
        now: deps.now(),
      });
      if (result.kind === 'unavailable') return sendProblem(reply, request, BAD_GATEWAY);
      return reply
        .header('cache-control', 'no-store')
        .header('set-cookie', clearedSessionCookie(deps.tls))
        .send({ redirect: result.redirect });
    });
    return Promise.resolve();
  });
}
