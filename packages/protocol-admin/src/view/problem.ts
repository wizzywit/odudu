import { type ProblemDetails } from '@odudu/contracts/admin';
import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

export type Problem = Omit<ProblemDetails, 'instance'> & { detail?: string };

export function problem(status: number, type: string, title: string, detail?: string): Problem {
  return detail === undefined ? { type, title, status } : { type, title, status, detail };
}

/**
 * The two refusals a mandatory `If-Match` produces, worded once for every
 * route that replaces an authorization-bearing list whole. `resource`
 * names what the caller has to read first, since the header is the only
 * thing missing from an otherwise valid request.
 */
export function ifMatchRequired(resource: string): Problem {
  return problem(
    428,
    'about:blank',
    'Precondition Required',
    `If-Match is required to replace ${resource}`,
  );
}

export function ifMatchStale(): Problem {
  return problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches');
}

export function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  body: Problem,
): FastifyReply {
  return reply
    .code(body.status)
    .header('content-type', 'application/problem+json')
    .send({ ...body, instance: request.id });
}

/** Scoped to this plugin's encapsulation context, never the root instance, so RFC 6749 error bodies on the OIDC routes are untouched. */
export function installProblemDetailsHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      sendProblem(reply, request, problem(status, 'about:blank', 'Internal Server Error'));
      return;
    }
    sendProblem(reply, request, problem(status, 'about:blank', error.name, error.message));
  });

  app.setNotFoundHandler((request, reply) => {
    sendProblem(
      reply,
      request,
      problem(404, 'about:blank#not-found', 'Not Found', `No admin route for ${request.url}`),
    );
  });
}
