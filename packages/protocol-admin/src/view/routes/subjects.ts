import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { type Clock } from '@odudu/kernel';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { requiredCapability } from '#/service/capability';
import { authenticateAdmin, type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';
import { authorizeAdmin, type AuthorizeAdminDeps } from '#/usecase/authorize-admin';

const METHOD = 'GET';
const PATH = '/admin/tenants/:tenant/subjects';

// The shape `view/problem.ts` will own for every admin route; duplicated
// from whoami.ts until that module exists.
function sendUnauthorized(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .header('content-type', 'application/problem+json')
    .send({ type: 'about:blank', title: 'Unauthorized', status: 401, instance: request.id });
}

function sendForbidden(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(403)
    .header('content-type', 'application/problem+json')
    .send({ type: 'about:blank', title: 'Forbidden', status: 403, instance: request.id });
}

// A placeholder returning an empty list, so the authorization chain around
// it is exercisable. Subject listing itself is a later increment's route.
export function registerListSubjectsRoute(
  app: FastifyInstance,
  authDeps: AuthenticateAdminDeps,
  authzDeps: AuthorizeAdminDeps,
  clock: Clock,
): void {
  app.get<{ Params: { tenant: string } }>(PATH, async (request, reply) => {
    const targetTenant = await authDeps.findTenant(request.params.tenant);
    if (targetTenant === null) return sendUnauthorized(request, reply);

    const outcome = await authenticateAdmin(authDeps, {
      authorizationHeader: request.headers.authorization,
      targetTenantName: request.params.tenant,
      targetTenantIssuer: tenantIssuerFor(request, request.params.tenant),
      systemTenantIssuer: tenantIssuerFor(request, SYSTEM_TENANT_NAME),
      now: clock.now(),
    });
    if (outcome.kind === 'unauthenticated') return sendUnauthorized(request, reply);

    const required = requiredCapability(METHOD, PATH) ?? null;
    const decision = await authorizeAdmin(
      authzDeps,
      outcome.principal,
      { tenantId: targetTenant.id },
      required,
    );
    if (decision === 'forbidden') return sendForbidden(request, reply);

    return reply.code(200).send([]);
  });
}
