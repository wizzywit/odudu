import { addressUrl, MCP_RESOURCE_PATH, type TenantAddress } from '@odudu/kernel';

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
