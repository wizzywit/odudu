import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { type FastifyInstance } from 'fastify';
import { believedSubject } from '#/service/console-subject';
import { type AdminMethod } from '#/service/odudu-port';
import { upstreamPath } from '#/service/rewrite';
import { forwardAdminCall, type ForwardDeps } from '#/usecase/forward';
import { BAD_GATEWAY, PRINCIPAL_CHANGED, sendProblem } from '#/view/problem';
import { sessionEnded } from '#/view/routes/session';
import { callerOf } from '#/view/scope';

export interface ProxyRouteDeps extends ForwardDeps {
  readonly now: () => Date;
}

const METHODS: readonly AdminMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function adminMethod(method: string): AdminMethod | null {
  return method === 'HEAD' ? 'HEAD' : (METHODS.find((m) => m === method) ?? null);
}

// Its own scope, so the body reaches the admin API as the bytes the browser
// sent, whatever its media type, rather than as a value parsed and
// re-serialised here.
export function registerProxyRoutes(api: FastifyInstance, deps: ProxyRouteDeps): void {
  api.register((proxy) => {
    proxy.removeAllContentTypeParsers();
    proxy.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    proxy.route({
      method: [...METHODS],
      url: '/admin/*',
      bodyLimit: TENANT_IMPORT_BODY_LIMIT,
      handler: async (request, reply) => {
        const path = upstreamPath(request.url);
        const method = adminMethod(request.method);
        if (path === null || method === null) {
          return sendProblem(reply, request, {
            status: 404,
            type: 'about:blank#not-found',
            title: 'Not Found',
          });
        }
        const result = await forwardAdminCall(deps, {
          method,
          path,
          headers: request.headers,
          body: Buffer.isBuffer(request.body) ? request.body : undefined,
          believedSubject: believedSubject(request.headers),
          from: callerOf(request),
          now: deps.now(),
        });
        if (result.kind === 'ended') return sessionEnded(reply, request, deps.tls);
        if (result.kind === 'principal-changed') {
          return sendProblem(reply, request, PRINCIPAL_CHANGED);
        }
        if (result.kind === 'unavailable') {
          return sendProblem(reply, request, BAD_GATEWAY);
        }
        reply.code(result.status).headers(result.headers);
        return result.body.length === 0 ? reply.send() : reply.send(result.body);
      },
    });
    return Promise.resolve();
  });
}
