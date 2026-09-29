import {
  listGroupsResponseSchema,
  listRolesResponseSchema,
  type ListGroupsResponse,
  type ListRolesResponse,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

// The role and group lists every picker chooses from, whichever record it
// sits on.
export function readRolePage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListRolesResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${encodeURIComponent(tenant)}/roles?${query.toString()}`,
    {
      schema: listRolesResponseSchema,
    },
  );
}

export function readGroupPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListGroupsResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${encodeURIComponent(tenant)}/groups?${query.toString()}`,
    {
      schema: listGroupsResponseSchema,
    },
  );
}
