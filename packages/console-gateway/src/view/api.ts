import { type FastifyError, type FastifyInstance } from 'fastify';
import { registerCsrfGuard } from '#/view/csrf-guard';
import { sendProblem } from '#/view/problem';
import { registerSessionRoutes, type SessionRouteDeps } from '#/view/routes/session';

export interface ApiDeps extends SessionRouteDeps {
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
}
