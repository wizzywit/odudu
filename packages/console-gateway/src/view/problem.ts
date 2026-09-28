import { type ProblemDetails } from '@odudu/contracts/admin';
import { type FastifyReply, type FastifyRequest } from 'fastify';

/** The admin API's problem shape, less the `instance` every answer adds. */
export type ConsoleProblem = Readonly<Omit<ProblemDetails, 'instance'>> & {
  readonly detail?: string;
};

export const SESSION_ENDED: ConsoleProblem = {
  status: 401,
  type: 'about:blank#console-session-ended',
  title: 'Unauthorized',
};

// Another sign-in replaced the session this tab was showing; the session
// itself is live, so the cookie stays.
export const PRINCIPAL_CHANGED: ConsoleProblem = {
  status: 409,
  type: 'about:blank#console-principal-changed',
  title: 'Conflict',
};

export const BAD_GATEWAY: ConsoleProblem = {
  status: 502,
  type: 'about:blank',
  title: 'Bad Gateway',
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
