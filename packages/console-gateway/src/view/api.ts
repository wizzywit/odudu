import { type FastifyError, type FastifyInstance } from 'fastify';
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

  api.setNotFoundHandler(async (request, reply) =>
    sendProblem(reply, request, {
      status: 404,
      type: 'about:blank#not-found',
      title: 'Not Found',
    }),
  );

  registerSessionRoutes(api, deps);
  registerProxyRoutes(api, deps);
}
