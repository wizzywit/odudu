import { type FastifyReply } from 'fastify';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';
import { type AdminRequest } from '#/view/routes/router';

export function whoamiHandler(
  _request: AdminRequest,
  reply: FastifyReply,
  principal: AdminPrincipal,
): FastifyReply {
  return reply.code(200).send({
    subjectId: principal.subjectId,
    issuerTenantId: principal.issuerTenantId,
  });
}
