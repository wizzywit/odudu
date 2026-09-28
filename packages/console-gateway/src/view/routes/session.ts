import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { clearedSessionCookie } from '#/service/cookies';
import {
  describeSession,
  resolveSession,
  type ResolveSessionDeps,
} from '#/usecase/resolve-session';
import { SESSION_ENDED, sendProblem } from '#/view/problem';

export interface SessionRouteDeps extends ResolveSessionDeps {
  readonly now: () => Date;
}

export function sessionEnded(
  reply: FastifyReply,
  request: FastifyRequest,
  tls: boolean,
): FastifyReply {
  return sendProblem(reply.header('set-cookie', clearedSessionCookie(tls)), request, SESSION_ENDED);
}

export function registerSessionRoutes(fastify: FastifyInstance, deps: SessionRouteDeps): void {
  fastify.get('/session', async (request, reply) => {
    const resolved = await resolveSession(deps, request.headers.cookie, deps.now(), request.ip);
    if (resolved.kind === 'ended') return sessionEnded(reply, request, deps.tls);
    const summary = await describeSession(deps, resolved.session);
    if (summary === null) return sessionEnded(reply, request, deps.tls);
    return reply.header('cache-control', 'no-store').send({
      tenant: summary.tenant,
      subject_id: summary.subjectId,
      username: summary.username,
    });
  });
}
