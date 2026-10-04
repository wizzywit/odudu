import {
  countResponseSchema,
  importTenantResponseSchema,
  listTenantsResponseSchema,
  tenantSchema,
  type CountResponse,
  type ImportTenantResponse,
  type ListTenantsResponse,
  type Tenant,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Gateway, GatewayResult, RawBody } from '#/shared/transport/gateway.ts';

function tenantPath(name: string): string {
  return encodeURIComponent(name);
}

export function readTenantPage(
  gateway: Gateway,
  query: URLSearchParams,
): Promise<GatewayResult<ListTenantsResponse>> {
  return gateway.request('GET', `admin/tenants?${query.toString()}`, {
    schema: listTenantsResponseSchema,
  });
}

export function readTenantCount(
  gateway: Gateway,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  return gateway.request('GET', `admin/tenants/count?${query.toString()}`, {
    schema: countResponseSchema,
  });
}

// An empty display name is no display name: the server keeps null for it.
function displayNameOf(displayName: string): { display_name?: string } {
  return displayName === '' ? {} : { display_name: displayName };
}

export function createTenant(
  gateway: Gateway,
  input: { name: string; displayName: string },
): Promise<GatewayResult<Tenant>> {
  return gateway.request('POST', 'admin/tenants', {
    body: { name: input.name, ...displayNameOf(input.displayName) },
    schema: tenantSchema,
  });
}

// The list's `name` is a prefix search, sorted by name, so the exact name
// is on the first page whenever it exists.
export async function findTenant(
  gateway: Gateway,
  name: string,
): Promise<GatewayResult<Tenant | null>> {
  const result = await readTenantPage(gateway, new URLSearchParams({ name }));
  if (!result.ok) return result;
  return { ...result, data: result.data.items.find((tenant) => tenant.name === name) ?? null };
}

export function readTenant(gateway: Gateway, name: string): Promise<GatewayResult<Tenant>> {
  return gateway.request('GET', `admin/tenants/${tenantPath(name)}`, { schema: tenantSchema });
}

export function amendTenant(
  gateway: Gateway,
  name: string,
  changes: { display_name?: string | null; enabled?: boolean },
  ifMatch: string,
): Promise<GatewayResult<Tenant>> {
  return gateway.request('PATCH', `admin/tenants/${tenantPath(name)}`, {
    body: changes,
    ifMatch,
    schema: tenantSchema,
  });
}

export function importTenant(
  gateway: Gateway,
  input: { name: string; displayName: string; document: unknown },
): Promise<GatewayResult<ImportTenantResponse>> {
  return gateway.request('POST', 'admin/tenant-imports', {
    body: { name: input.name, ...displayNameOf(input.displayName), document: input.document },
    schema: importTenantResponseSchema,
  });
}

export function readExport(
  gateway: Gateway,
  name: string,
  includeSubjects: boolean,
): Promise<GatewayResult<RawBody>> {
  const t = tenantPath(name);
  return includeSubjects
    ? gateway.download('GET', `admin/tenants/${t}/export?include=subjects`)
    : gateway.download('GET', `admin/tenants/${t}/export`);
}

const discoverySchema = z.looseObject({ issuer: z.string() });

export async function readSystemIssuer(gateway: Gateway): Promise<GatewayResult<string>> {
  const result = await gateway.request('GET', 'tenants/system/discovery', {
    schema: discoverySchema,
  });
  return result.ok ? { ...result, data: result.data.issuer } : result;
}
