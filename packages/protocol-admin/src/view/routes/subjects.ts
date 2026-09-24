import { type FastifyReply } from 'fastify';
import { type AdminRequest } from '#/view/routes/router';

// A placeholder returning an empty list, so the authorization chain around
// it is exercisable. Subject listing itself is a later increment's route.
export function listSubjectsHandler(_request: AdminRequest, reply: FastifyReply): FastifyReply {
  return reply.code(200).send([]);
}
