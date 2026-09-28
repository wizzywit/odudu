import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  clearedLoginCookie,
  loginCookie,
  loginCookieName,
  readCookie,
  sessionCookie,
} from '#/service/cookies';
import { beginLogin, type LoginDeps } from '#/usecase/begin-login';
import { completeLogin, type CompleteLoginDeps } from '#/usecase/complete-login';
import { registerCsrfGuard } from '#/view/csrf-guard';
import { renderSignInRefused } from '#/view/refusal-html';
import { registerLogoutRoute, type LogoutRouteDeps } from '#/view/routes/logout';
import { sendPage } from '#/view/send-page';

export interface AuthRouteDeps {
  readonly login: LoginDeps;
  readonly callback: CompleteLoginDeps;
  readonly logout: LogoutRouteDeps;
  readonly tls: boolean;
  readonly now: () => Date;
  /** The origin of `ODUDU_PUBLIC_BASE_URL`, the only one a write may come from. */
  readonly origin: string;
}

// A parameter given twice is as unusable as one never given.
function single(query: unknown, name: string): string | undefined {
  if (typeof query !== 'object' || query === null) return undefined;
  const value: unknown = (query as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function refuse(reply: FastifyReply, status: number, cookies: readonly string[]): FastifyReply {
  if (cookies.length > 0) reply.header('set-cookie', [...cookies]);
  return sendPage(reply.header('cache-control', 'no-store'), status, renderSignInRefused());
}

function redirect(reply: FastifyReply, location: string, cookies: readonly string[]): FastifyReply {
  return reply
    .header('cache-control', 'no-store')
    .header('set-cookie', [...cookies])
    .redirect(location, 302);
}

// Registered under the /console/auth prefix. The guard refuses a write
// without the console's headers, which here is the logout alone.
export function registerAuthRoutes(fastify: FastifyInstance, deps: AuthRouteDeps): void {
  registerCsrfGuard(fastify, deps.origin);

  // A failed query's message carries its parameters, which here are a
  // login's hashes and wrapped secrets, so only the error's kind is logged
  // and the browser sees the same page every refusal gets.
  fastify.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) return refuse(reply, status, [clearedLoginCookie(deps.tls)]);
    request.log.error({ err: { type: error.name, code: error.code } }, 'console sign-in failed');
    return refuse(reply, 500, [clearedLoginCookie(deps.tls)]);
  });

  const notFound = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
    refuse(reply, 404, []);
  fastify.setNotFoundHandler(notFound);
  // An actual route, not only the handler above: `setNotFoundHandler`
  // only runs once nothing in the whole app matches, so a GET this scope
  // has no route for — the bare prefix included — would otherwise match
  // a shallower wildcard, such as the console shell's `/console/*`. This
  // claims the whole prefix instead, bare and every path under it.
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
  fastify.route({ method: [...methods], url: '', handler: notFound });
  fastify.route({ method: [...methods], url: '/*', handler: notFound });

  fastify.get('/login', async (request, reply) => {
    const result = await beginLogin(deps.login, {
      tenant: single(request.query, 'tenant'),
      returnTo: single(request.query, 'return_to'),
      now: deps.now(),
    });
    if (result.kind === 'refused') return refuse(reply, 400, []);
    return redirect(reply, result.location, [loginCookie(result.state, deps.tls)]);
  });

  fastify.get('/callback', async (request, reply) => {
    const result = await completeLogin(deps.callback, {
      code: single(request.query, 'code'),
      state: single(request.query, 'state'),
      iss: single(request.query, 'iss'),
      error: single(request.query, 'error'),
      loginCookie: readCookie(request.headers.cookie, loginCookieName(deps.tls)),
      ip: request.ip,
      now: deps.now(),
    });
    const cleared = clearedLoginCookie(deps.tls);
    if (result.kind === 'refused') return refuse(reply, 400, [cleared]);
    const cookies =
      result.kind === 'signed-in'
        ? [cleared, sessionCookie(result.sessionCookie, deps.tls)]
        : [cleared];
    return redirect(reply, result.location, cookies);
  });

  registerLogoutRoute(fastify, deps.logout);
}
