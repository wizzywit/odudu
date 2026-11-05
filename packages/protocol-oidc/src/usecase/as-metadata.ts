import { asMetadataDocument, type AsMetadataDocument } from '@odudu/contracts';
import { type TenantAddress } from '@odudu/kernel';
import { resolveDiscoveryDocument, type DiscoveryUsecaseDeps } from '#/usecase/discovery';
import { withMcpScopes } from '#/service/mcp-scopes';

export type AsMetadataUsecaseDeps = DiscoveryUsecaseDeps;

// RFC 8414 metadata for one tenant, projected from its discovery document.
// Null for an unknown or a disabled tenant, which the view turns into the same
// empty 404: a disabled tenant serves no token endpoint, so a client that
// found it here would be pointed at a refusal. Discovery, which still
// publishes a disabled tenant's keys, does not make that choice.
export async function resolveAsMetadata(
  deps: AsMetadataUsecaseDeps,
  tenantName: string,
  address: TenantAddress,
): Promise<AsMetadataDocument | null> {
  const tenant = await deps.findTenant(tenantName);
  if (tenant?.enabled !== true) return null;
  const discovery = await resolveDiscoveryDocument(
    { ...deps, findTenant: () => Promise.resolve(tenant) },
    tenantName,
    address,
  );
  if (discovery === null) return null;
  return asMetadataDocument(discovery, withMcpScopes(discovery.scopes_supported ?? []));
}
