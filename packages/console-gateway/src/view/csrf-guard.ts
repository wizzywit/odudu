import { type FastifyInstance } from 'fastify';
import { csrfRefusal } from '#/service/csrf';
import { sendProblem } from '#/view/problem';

// onRequest, so a refused write is answered before its body is parsed and
// before any route, the not-found handler included, can act on it.
export function registerCsrfGuard(fastify: FastifyInstance, origin: string): void {
  fastify.addHook('onRequest', async (request, reply) => {
    const reason = csrfRefusal(request, origin);
    if (reason === null) return;
    request.log.warn({ reason }, 'console write refused as cross-site');
    return sendProblem(reply, request, {
      status: 403,
      type: 'about:blank#forbidden',
      title: 'Forbidden',
      detail: `refused as cross-site: ${reason}`,
    });
  });
}
