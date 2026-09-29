import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { STATUS_CODES } from 'node:http';
import { registerCsrfGuard } from '#/view/csrf-guard';
import { sendProblem } from '#/view/problem';
import { registerDiscoveryRoutes } from '#/view/routes/discovery';
import { registerProxyRoutes, type ProxyRouteDeps } from '#/view/routes/proxy';
import { registerSessionRoutes } from '#/view/routes/session';
import { answerErrors, claimPrefix } from '#/view/scope';

export interface ApiDeps extends ProxyRouteDeps {
  /** The origin of `ODUDU_PUBLIC_BASE_URL`, the only one a write may come from. */
  readonly origin: string;
}

// Registered under the /console/api prefix, so the guard and the problem
// handlers cover every route there and the not-found answer too.
export function registerConsoleApi(api: FastifyInstance, deps: ApiDeps): void {
  registerCsrfGuard(api, deps.origin);

  answerErrors(api, 'console API failed', (request, reply, status) =>
    sendProblem(reply, request, {
      status,
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Bad Request',
    }),
  );

  claimPrefix(api, async (request: FastifyRequest, reply: FastifyReply) =>
    sendProblem(reply, request, {
      status: 404,
      type: 'about:blank#not-found',
      title: 'Not Found',
    }),
  );

  registerSessionRoutes(api, deps);
  registerDiscoveryRoutes(api, deps);
  registerProxyRoutes(api, deps);
}
