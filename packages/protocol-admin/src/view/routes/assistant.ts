import { type AssistantStatus } from '@odudu/contracts/admin';
import { type FastifyReply } from 'fastify';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface AssistantRouteDeps {
  readonly status: () => AssistantStatus;
}

export function assistantStatusHandler(deps: AssistantRouteDeps): AdminRouteHandler {
  return function handleAssistantStatus(_request, reply): FastifyReply {
    return reply.code(200).send(deps.status());
  };
}
