import { type FastifyInstance } from 'fastify';
import { clearedSessionCookie } from '#/service/cookies';
import { logout, type LogoutDeps } from '#/usecase/logout';

export interface LogoutRouteDeps extends LogoutDeps {
  readonly now: () => Date;
}

// A JSON body rather than a 302: the CSRF guard needs a custom header, so
// this is a fetch, and a fetch that follows a redirect cannot move the page.
// The SPA navigates to the answer itself.
export function registerLogoutRoute(fastify: FastifyInstance, deps: LogoutRouteDeps): void {
  fastify.post('/logout', async (request, reply) => {
    const { redirect } = await logout(deps, {
      cookieHeader: request.headers.cookie,
      ip: request.ip,
      now: deps.now(),
    });
    return reply
      .header('cache-control', 'no-store')
      .header('set-cookie', clearedSessionCookie(deps.tls))
      .send({ redirect });
  });
}
