import {
  countResponseSchema,
  importTenantResponseSchema,
  listTenantsResponseSchema,
  tenantSchema,
  type CountResponse,
  type Tenant as WireTenant,
} from '@odudu/contracts/admin';
import { readDiscovery } from '#/entities/tenant';
import type { ImportedSecret } from '#/pages/tenants/services/import';
import type { Tenant } from '#/pages/tenants/types/tenant';
import type { ListPage } from '#/shared/services/resourceList';
import type { Gateway, GatewayResult, RawBody } from '#/shared/transport/gateway';
import { adminRootCall, firstMatch, mapResult, nothing, segment } from '#/shared/adapter/route';
import { SYSTEM_TENANT } from '#/shared/services/principal';

function tenantOf(wire: WireTenant): Tenant {
  return {
    name: wire.name,
    displayName: wire.display_name,
    enabled: wire.enabled,
    createdAt: wire.created_at,
  };
}

export async function readTenantPage(
  gateway: Gateway,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<Tenant>>> {
  const result = await adminRootCall(gateway, 'GET', ['tenants'], {
    query,
    schema: listTenantsResponseSchema,
  });
  return mapResult(result, ({ items, next }) => ({ items: items.map(tenantOf), next }));
}

export function readTenantCount(
  gateway: Gateway,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  return adminRootCall(gateway, 'GET', ['tenants', 'count'], {
    query,
    schema: countResponseSchema,
  });
}

// An empty display name is no display name: the server keeps null for it.
function displayNameOf(displayName: string): { display_name?: string } {
  return displayName === '' ? {} : { display_name: displayName };
}

export async function createTenant(
  gateway: Gateway,
  input: { name: string; displayName: string },
): Promise<GatewayResult<Tenant>> {
  const result = await adminRootCall(gateway, 'POST', ['tenants'], {
    body: { name: input.name, ...displayNameOf(input.displayName) },
    schema: tenantSchema,
  });
  return mapResult(result, tenantOf);
}

// The list's `name` is a prefix search, sorted by name, so the exact name
// is on the first page whenever it exists.
export async function findTenant(
  gateway: Gateway,
  name: string,
): Promise<GatewayResult<Tenant | null>> {
  const result = await readTenantPage(gateway, new URLSearchParams({ name }));
  return firstMatch(result, (tenant) => tenant.name === name);
}

export async function readTenant(gateway: Gateway, name: string): Promise<GatewayResult<Tenant>> {
  const result = await adminRootCall(gateway, 'GET', ['tenants', name], { schema: tenantSchema });
  return mapResult(result, tenantOf);
}

// An emptied display name is cleared, as the server keeps no empty one.
export async function amendTenant(
  gateway: Gateway,
  name: string,
  changes: { display_name?: string | null; enabled?: boolean },
  ifMatch: string,
): Promise<GatewayResult<Tenant>> {
  const result = await adminRootCall(gateway, 'PATCH', ['tenants', name], {
    body: changes.display_name === '' ? { ...changes, display_name: null } : changes,
    ifMatch,
    schema: tenantSchema,
  });
  return mapResult(result, tenantOf);
}

// The server wants the tenant's own name again, so a slip of the path
// deletes nothing.
export function deleteTenant(gateway: Gateway, name: string): Promise<GatewayResult<undefined>> {
  return adminRootCall(gateway, 'DELETE', ['tenants', name], {
    query: new URLSearchParams({ confirm: name }),
    schema: nothing,
  });
}

export async function importTenant(
  gateway: Gateway,
  input: { name: string; displayName: string; document: unknown },
): Promise<GatewayResult<{ tenant: Tenant; secrets: ImportedSecret[] }>> {
  const result = await adminRootCall(gateway, 'POST', ['tenant-imports'], {
    body: { name: input.name, ...displayNameOf(input.displayName), document: input.document },
    schema: importTenantResponseSchema,
  });
  return mapResult(result, ({ tenant, client_secrets }) => ({
    tenant: tenantOf(tenant),
    secrets: client_secrets.map(({ client_id, secret }) => ({ clientId: client_id, secret })),
  }));
}

export function readExport(
  gateway: Gateway,
  name: string,
  includeSubjects: boolean,
): Promise<GatewayResult<RawBody>> {
  const t = segment(name);
  return includeSubjects
    ? gateway.download('GET', `admin/tenants/${t}/export?include=subjects`)
    : gateway.download('GET', `admin/tenants/${t}/export`);
}

export async function readSystemIssuer(gateway: Gateway): Promise<GatewayResult<string>> {
  const result = await readDiscovery(gateway, SYSTEM_TENANT);
  return result.ok ? { ...result, data: result.data.issuer } : result;
}
