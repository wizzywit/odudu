import { type FastifyReply, type FastifyRequest } from 'fastify';

export interface ConsoleProblem {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
}

export const SESSION_ENDED: ConsoleProblem = {
  status: 401,
  type: 'about:blank#console-session-ended',
  title: 'Unauthorized',
};

export function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  problem: ConsoleProblem,
): FastifyReply {
  return reply
    .code(problem.status)
    .header('content-type', 'application/problem+json')
    .header('cache-control', 'no-store')
    .send({ ...problem, instance: request.id });
}
