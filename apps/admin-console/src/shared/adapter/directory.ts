import {
  listClientsResponseSchema,
  listGroupsResponseSchema,
  listKeysResponseSchema,
  listRolesResponseSchema,
  listScopesResponseSchema,
  roleSchema,
  type Role,
} from '@odudu/contracts/admin';
import { adminCall, countReader, listReader } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';

// The lists and counts that more than one feature reads, whichever record
// they sit on; a picker's own list is the same call as the page's.
export const readRolePage = listReader('roles', listRolesResponseSchema);
export const readRoleCount = countReader('roles');
export const readGroupPage = listReader('groups', listGroupsResponseSchema);
export const readScopePage = listReader('scopes', listScopesResponseSchema);
export const readClientPage = listReader('clients', listClientsResponseSchema);
export const readKeyPage = listReader('keys', listKeysResponseSchema);

// One role with what it reaches, for a list that names a role by id alone.
export function readRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<Role>> {
  return adminCall(gateway, 'GET', tenant, ['roles', roleId], { schema: roleSchema });
}
