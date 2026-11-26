import { SEND_MESSAGE_BODY_LIMIT, TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { believedSubject } from '#/service/console-subject';
import { type AdminMethod } from '#/service/odudu-port';
import { upstreamPath } from '#/service/rewrite';
import { forwardAdminCall, type ForwardDeps, type Refusal } from '#/usecase/forward';
import { forwardAdminStream } from '#/usecase/forward-stream';
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

// The ways a call is refused before the admin API answers it, as the browser
// is told them.
function refused(
  result: Refusal,
  request: FastifyRequest,
  reply: FastifyReply,
  tls: ProxyRouteDeps['tls'],
): FastifyReply {
  if (result.kind === 'ended') return sessionEnded(reply, request, tls);
  if (result.kind === 'principal-changed') return sendProblem(reply, request, PRINCIPAL_CHANGED);
  return sendProblem(reply, request, BAD_GATEWAY);
}

// The routes whose response is read as it is written, two admin calls among
// the rest: a message and the carrying on of a turn after a decision. They are
// registered ahead of the wildcard, which is the more specific route's to win,
// and take the body as bytes as the wildcard does.
const STREAMED = [
  '/admin/tenants/:tenant/assistant/conversations/:id/messages',
  '/admin/tenants/:tenant/assistant/conversations/:id/resume',
];

// Its own scope, so the body reaches the admin API as the bytes the browser
// sent, whatever its media type, rather than as a value parsed and
// re-serialised here.
export function registerProxyRoutes(api: FastifyInstance, deps: ProxyRouteDeps): void {
  api.register((proxy) => {
    proxy.removeAllContentTypeParsers();
    proxy.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    for (const url of STREAMED) {
      proxy.route({
        method: 'POST',
        url,
        bodyLimit: SEND_MESSAGE_BODY_LIMIT,
        handler: async (request, reply) => {
          const path = upstreamPath(request.url);
          if (path === null) {
            return sendProblem(reply, request, {
              status: 404,
              type: 'about:blank#not-found',
              title: 'Not Found',
            });
          }
          const gone = new AbortController();
          reply.raw.once('close', () => {
            if (!reply.raw.writableFinished) gone.abort();
          });
          const result = await forwardAdminStream(deps, {
            method: 'POST',
            path,
            headers: request.headers,
            body: Buffer.isBuffer(request.body) ? request.body : undefined,
            believedSubject: believedSubject(request.headers),
            from: callerOf(request),
            now: deps.now(),
            signal: gone.signal,
          });
          if (result.kind !== 'streaming') return refused(result, request, reply, deps.tls);
          reply.code(result.status).headers(result.headers);
          return reply.send(result.body);
        },
      });
    }

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
        if (result.kind !== 'forwarded') return refused(result, request, reply, deps.tls);
        reply.code(result.status).headers(result.headers);
        return result.body.length === 0 ? reply.send() : reply.send(result.body);
      },
    });
    return Promise.resolve();
  });
}
