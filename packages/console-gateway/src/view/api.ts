import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { STATUS_CODES } from 'node:http';
import { registerCsrfGuard } from '#/view/csrf-guard';
import { sendProblem } from '#/view/problem';
import { registerProxyRoutes, type ProxyRouteDeps } from '#/view/routes/proxy';
import { registerSessionRoutes } from '#/view/routes/session';

export interface ApiDeps extends ProxyRouteDeps {
  /** The origin of `ODUDU_PUBLIC_BASE_URL`, the only one a write may come from. */
  readonly origin: string;
}

// Registered under the /console/api prefix, so the guard and the problem
// handlers cover every route there and the not-found answer too.
export function registerConsoleApi(api: FastifyInstance, deps: ApiDeps): void {
  registerCsrfGuard(api, deps.origin);

  // A failed query's message carries its parameters, among them a
  // session's secret hash, so only the error's kind is logged.
  api.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(reply, request, {
        status,
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Bad Request',
      });
    }
    request.log.error({ err: { type: error.name, code: error.code } }, 'console API failed');
    return sendProblem(reply, request, {
      status: 500,
      type: 'about:blank',
      title: 'Internal Server Error',
    });
  });

  const notFound = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
    sendProblem(reply, request, {
      status: 404,
      type: 'about:blank#not-found',
      title: 'Not Found',
    });

  api.setNotFoundHandler(notFound);
  // An actual route, not only the handler above: a `..` segment that
  // resolves back inside this prefix (say `/admin/%2e%2e/tenants`, which
  // find-my-way normalises before matching) is a real match for a
  // shallower wildcard, such as the console shell's `/console/*` — one
  // that never runs `setNotFoundHandler`'s own fallback router at all.
  // Claiming the whole prefix here keeps every such path answered from
  // this plugin, same as one Fastify would never have routed elsewhere.
  api.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    url: '/*',
    handler: notFound,
  });

  registerSessionRoutes(api, deps);
  registerProxyRoutes(api, deps);
}
