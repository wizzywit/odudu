import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

export type ScopeAnswer = (
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
) => FastifyReply | Promise<FastifyReply>;

// A failed query's message carries its parameters, among them a session's
// secret hash or a login's wrapped secrets, so only the error's kind is
// logged. A client error keeps its own status.
export function answerErrors(fastify: FastifyInstance, message: string, answer: ScopeAnswer): void {
  fastify.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) return answer(request, reply, status);
    request.log.error({ err: { type: error.name, code: error.code } }, message);
    return answer(request, reply, 500);
  });
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

// Actual routes, not only the not-found handler: that runs once nothing in
// the whole app matches, so a path this scope has no route for, the bare
// prefix included, would otherwise match a shallower wildcard such as the
// console shell's `/console/*`. These claim the whole prefix instead.
export function claimPrefix(
  fastify: FastifyInstance,
  notFound: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>,
): void {
  fastify.setNotFoundHandler(notFound);
  fastify.route({ method: [...METHODS], url: '', handler: notFound });
  fastify.route({ method: [...METHODS], url: '/*', handler: notFound });
}
