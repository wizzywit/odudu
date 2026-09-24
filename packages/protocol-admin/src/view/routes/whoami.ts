import { type Clock } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { authenticateAdmin, type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';

const PATH = '/admin/tenants/:tenant/whoami';

// A later task centralises RFC 9457 problem responses for every admin
// route (`view/problem.ts`); this is that shape, used early so the
// authentication chain has a route to prove itself against.
function sendUnauthorized(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .header('content-type', 'application/problem+json')
    .send({ type: 'about:blank', title: 'Unauthorized', status: 401, instance: request.id });
}

export function registerWhoamiRoute(
  app: FastifyInstance,
  deps: AuthenticateAdminDeps,
  clock: Clock,
): void {
  app.get<{ Params: { tenant: string } }>(PATH, async (request, reply) => {
    const outcome = await authenticateAdmin(deps, {
      authorizationHeader: request.headers.authorization,
      targetTenantName: request.params.tenant,
      now: clock.now(),
    });
    if (outcome.kind === 'unauthenticated') return sendUnauthorized(request, reply);
    return reply.code(200).send({
      subjectId: outcome.principal.subjectId,
      issuerTenantId: outcome.principal.issuerTenantId,
    });
  });
}
