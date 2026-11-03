import type { ListClientsResponse, ListRolesResponse } from '@odudu/contracts/admin';
import { readClientPage } from '#/entities/client';
import { readRolePage } from '#/entities/role';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';

// A client_id search is a prefix, so a tenant's own `odudu-admin-x` comes
// back too; the caller keeps the built-in one.
export function readAdminClients(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ListClientsResponse>> {
  return readClientPage(gateway, tenant, new URLSearchParams({ client_id: 'odudu-admin' }));
}

export function readClientRoles(
  gateway: Gateway,
  tenant: string,
  clientId: string,
  name?: string,
): Promise<GatewayResult<ListRolesResponse>> {
  const query = new URLSearchParams({ client: clientId });
  if (name !== undefined) query.set('name', name);
  return readRolePage(gateway, tenant, query);
}
