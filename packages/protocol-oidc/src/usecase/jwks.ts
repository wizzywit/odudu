import { assembleJwks } from '@odudu/crypto';
import { type TenantLookup } from '#/repository/tenant-lookup';

export interface PublishableKey {
  kid: string;
  alg: string;
  publicJwk: Record<string, unknown>;
}

export interface JwksUsecaseDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  listPublishableKeys(tenantId: string): Promise<PublishableKey[]>;
}

export async function resolveJwks(
  deps: JwksUsecaseDeps,
  tenantName: string,
): Promise<{ keys: Record<string, unknown>[] } | null> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) return null;
  const keys = await deps.listPublishableKeys(tenant.id);
  return assembleJwks(keys);
}
