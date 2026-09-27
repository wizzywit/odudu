import { MANAGE_TENANTS, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { type FastifyReply } from 'fastify';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface WhoamiRouteDeps {
  callerCapabilities(issuerTenantId: string, subjectId: string): Promise<ReadonlySet<string>>;
}

// `callerCapabilities` returns every admin-client role the caller holds,
// composites included — the role ceilings in subjects.ts/roles.ts need
// that whole set, `tenant-admin` and all. Reported here, it is narrowed to
// the vocabulary the spec promises: a capability, never the composite role
// that grants it.
const ADMIN_CAPABILITY_VOCABULARY: ReadonlySet<string> = new Set([
  ...TENANT_CAPABILITIES,
  MANAGE_TENANTS,
]);

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
      capabilities: [...capabilities].filter((c) => ADMIN_CAPABILITY_VOCABULARY.has(c)).sort(),
      crossTenant: principal.issuerTenantId !== targetTenantId,
    });
  };
}
