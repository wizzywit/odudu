import { type FastifyInstance } from 'fastify';
import { clearedSessionCookie } from '#/service/cookies';
import { logout, type LogoutDeps } from '#/usecase/logout';
import { BAD_GATEWAY, sendProblem } from '#/view/problem';

export interface LogoutRouteDeps extends LogoutDeps {
  readonly now: () => Date;
}

// A JSON body rather than a 302: the CSRF guard needs a custom header, so
// this is a fetch, and a fetch that follows a redirect cannot move the page.
// The SPA navigates to the answer itself.
export function registerLogoutRoute(fastify: FastifyInstance, deps: LogoutRouteDeps): void {
  fastify.post('/logout', async (request, reply) => {
    const result = await logout(deps, {
      cookieHeader: request.headers.cookie,
      ip: request.ip,
      now: deps.now(),
    });
    // The session was kept, so its cookie is too, and the logout can be retried.
    if (result.kind === 'unavailable') return sendProblem(reply, request, BAD_GATEWAY);
    return reply
      .header('cache-control', 'no-store')
      .header('set-cookie', clearedSessionCookie(deps.tls))
      .send({ redirect: result.redirect });
  });
}
