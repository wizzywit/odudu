import { addressIssuer, addressUrl, MCP_RESOURCE_PATH, type TenantAddress } from '@odudu/kernel';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';

// The MCP endpoint of a tenant, and so the `resource` its protected-resource
// metadata states and the audience its tokens carry. No trailing slash: a
// client compares it as a string (RFC 9728 §3.3, §7.3).
export function mcpResourceUrl(address: TenantAddress): string {
  return addressUrl(address, MCP_RESOURCE_PATH);
}

// RFC 9728 §3.1 inserts the well-known suffix between the host and the
// resource's path, so a tenant at the path address has the suffix before
// `/tenants/<name>/mcp` and a tenant at its own domain before `/mcp`.
export function resourceMetadataUrl(address: TenantAddress): string {
  return `${address.origin}${RESOURCE_METADATA_SUFFIX}${address.prefix}/mcp`;
}

export const RESOURCE_METADATA_SUFFIX = '/.well-known/oauth-protected-resource';

export interface ResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

// RFC 9728 metadata of a tenant's MCP endpoint. The one authorization server
// is the tenant's issuer, the value its RFC 8414 document states, because a
// client reads only the first entry.
export function resourceMetadataDocument(address: TenantAddress): ResourceMetadata {
  return {
    resource: mcpResourceUrl(address),
    authorization_servers: [addressIssuer(address)],
    scopes_supported: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    bearer_methods_supported: ['header'],
  };
}
