import { tenantAddressOf } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { resolveAsMetadata, type AsMetadataUsecaseDeps } from '#/usecase/as-metadata';

// RFC 8414 §3.1 inserts the well-known suffix between the host and the
// issuer's path, so a tenant at the path address is found here.
export const AS_METADATA_PATH_FORM = '/.well-known/oauth-authorization-server/tenants/:tenant';
// A tenant at its own domain has an issuer with no path, so its document sits
// at `/.well-known/oauth-authorization-server` of that host; the host's
// rewrite files that request under the tenant, where this route reads it.
export const AS_METADATA_DOMAIN_FORM = '/tenants/:tenant/.well-known/oauth-authorization-server';

export function registerAsMetadataRoutes(app: FastifyInstance, deps: AsMetadataUsecaseDeps): void {
  async function answer(
    request: FastifyRequest<{ Params: { tenant: string } }>,
    reply: FastifyReply,
  ) {
    // Public and unauthenticated, like discovery: every origin may read it.
    reply.header('access-control-allow-origin', '*');
    const doc = await resolveAsMetadata(deps, request.params.tenant, tenantAddressOf(request));
    if (doc === null) return reply.code(404).send();
    return doc;
  }

  app.get<{ Params: { tenant: string } }>(AS_METADATA_PATH_FORM, answer);
  app.get<{ Params: { tenant: string } }>(AS_METADATA_DOMAIN_FORM, (request, reply) =>
    // Only a domain host's rewrite reaches a tenant's issuer at this URL; at
    // the path address the issuer's own metadata URL is the other one.
    request.tenantAddress?.prefix === '' ? answer(request, reply) : reply.code(404).send(),
  );
}
