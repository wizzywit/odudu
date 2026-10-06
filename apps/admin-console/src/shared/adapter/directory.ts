import {
  countResponseSchema,
  listGroupsResponseSchema,
  listRolesResponseSchema,
  listScopesResponseSchema,
  roleSchema,
  type CountResponse,
  type ListGroupsResponse,
  type ListRolesResponse,
  type ListScopesResponse,
  type Role,
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

// One role with what it reaches, for a list that names a role by id alone.
export function readRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<Role>> {
  return gateway.request(
    'GET',
    `admin/tenants/${encodeURIComponent(tenant)}/roles/${encodeURIComponent(roleId)}`,
    { schema: roleSchema },
  );
}

// What a list of roles is counted by, for a count shown beside a picker's own list.
export function readRoleCount(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${encodeURIComponent(tenant)}/roles/count?${query.toString()}`,
    { schema: countResponseSchema },
  );
}

// The scopes a client is assigned from, searched by name on the server.
export function readScopePage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListScopesResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${encodeURIComponent(tenant)}/scopes?${query.toString()}`,
    { schema: listScopesResponseSchema },
  );
}
