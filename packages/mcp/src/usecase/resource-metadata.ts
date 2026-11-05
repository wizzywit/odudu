import { addressIssuer, type TenantAddress } from '@odudu/kernel';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import { mcpResourceUrl } from '#/service/resource';

export interface ResourceMetadataDeps {
  findTenant(name: string): Promise<{ readonly enabled: boolean } | null>;
}

export interface ResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

// RFC 9728 metadata of a tenant's MCP endpoint. The one authorization server
// is the tenant's issuer, the value its RFC 8414 document states, because a
// client reads only the first entry. Null for an unknown tenant and a disabled
// one, which the view answers alike.
export async function resolveResourceMetadata(
  deps: ResourceMetadataDeps,
  tenantName: string,
  address: TenantAddress,
): Promise<ResourceMetadata | null> {
  const tenant = await deps.findTenant(tenantName);
  if (tenant?.enabled !== true) return null;
  return {
    resource: mcpResourceUrl(address),
    authorization_servers: [addressIssuer(address)],
    scopes_supported: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    bearer_methods_supported: ['header'],
  };
}
