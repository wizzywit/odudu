import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { type Clock } from '@odudu/kernel';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { authenticateAdmin, type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';

const PATH = '/admin/tenants/:tenant/whoami';

// The shape `view/problem.ts` will own for every admin route; used here
// directly until that module exists.
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
      targetTenantIssuer: tenantIssuerFor(request, request.params.tenant),
      systemTenantIssuer: tenantIssuerFor(request, SYSTEM_TENANT_NAME),
      now: clock.now(),
    });
    if (outcome.kind === 'unauthenticated') return sendUnauthorized(request, reply);
    return reply.code(200).send({
      subjectId: outcome.principal.subjectId,
      issuerTenantId: outcome.principal.issuerTenantId,
    });
  });
}
