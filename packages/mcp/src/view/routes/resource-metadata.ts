import { tenantAddressOf } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { RESOURCE_METADATA_SUFFIX } from '#/service/resource';
import { resolveResourceMetadata, type ResourceMetadataDeps } from '#/usecase/resource-metadata';

// RFC 9728 §3.1: the well-known suffix goes between the host and the
// resource's path, so a tenant at the path address is found here.
export const RESOURCE_METADATA_PATH_FORM = `${RESOURCE_METADATA_SUFFIX}/tenants/:tenant/mcp`;
// A tenant at its own domain has a resource with the path `/mcp`; the host's
// rewrite files that request under the tenant, where this route reads it.
export const RESOURCE_METADATA_DOMAIN_FORM = `/tenants/:tenant${RESOURCE_METADATA_SUFFIX}/mcp`;

export function registerResourceMetadataRoute(
  app: FastifyInstance,
  deps: ResourceMetadataDeps,
): void {
  async function answer(
    request: FastifyRequest<{ Params: { tenant: string } }>,
    reply: FastifyReply,
  ) {
    // Public and unauthenticated: a browser-based client may read it.
    reply.header('access-control-allow-origin', '*');
    const doc = await resolveResourceMetadata(
      deps,
      request.params.tenant,
      tenantAddressOf(request),
    );
    if (doc === null) return reply.code(404).send();
    return doc;
  }

  app.get<{ Params: { tenant: string } }>(RESOURCE_METADATA_PATH_FORM, answer);
  app.get<{ Params: { tenant: string } }>(RESOURCE_METADATA_DOMAIN_FORM, (request, reply) =>
    // Only a domain host's rewrite reaches this URL with an address of no
    // prefix; at the path address the resource's own metadata URL is the other.
    request.tenantAddress?.prefix === '' ? answer(request, reply) : reply.code(404).send(),
  );
}
