import { type FastifyReply } from 'fastify';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface WhoamiRouteDeps {
  callerCapabilities(issuerTenantId: string, subjectId: string): Promise<ReadonlySet<string>>;
}

export function whoamiHandler(deps: WhoamiRouteDeps): AdminRouteHandler {
  return async function handleWhoami(
    _request: AdminRequest,
    reply: FastifyReply,
    principal: AdminPrincipal,
    targetTenantId: string,
  ): Promise<FastifyReply> {
    const capabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    return reply.code(200).send({
      subjectId: principal.subjectId,
      issuerTenantId: principal.issuerTenantId,
      capabilities: [...capabilities].sort(),
      crossTenant: principal.issuerTenantId !== targetTenantId,
    });
  };
}
