import type { TenantAddress } from '@odudu/kernel';
import { type ResourceMetadata, resourceMetadataDocument } from '#/service/resource';

export type { ResourceMetadata };

export interface ResourceMetadataDeps {
  findTenant(name: string): Promise<{ readonly enabled: boolean } | null>;
}

// Null for an unknown tenant and a disabled one, which the view answers alike.
export async function resolveResourceMetadata(
  deps: ResourceMetadataDeps,
  tenantName: string,
  address: TenantAddress,
): Promise<ResourceMetadata | null> {
  const tenant = await deps.findTenant(tenantName);
  if (tenant?.enabled !== true) return null;
  return resourceMetadataDocument(address);
}
