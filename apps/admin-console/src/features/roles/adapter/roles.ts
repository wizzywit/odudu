import { listRoleCompositesResponseSchema, MAX_LIMIT, roleSchema } from '@odudu/contracts/admin';
import { readRoleCount, readRolePage } from '#/shared/adapter/directory';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, firstMatch, nothing } from '#/shared/adapter/route';
import type { Role } from '#/entities/role';
import type { Composites } from '#/features/roles/types/composite';

export { readRoleCount, readRolePage };

// One role with what it reaches, for a list that names a role by id alone.
export function readRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<Role>> {
  return adminCall(gateway, 'GET', tenant, ['roles', roleId], { schema: roleSchema });
}

// A tenant role: a client's own roles are made from that client's page.
export function createRole(
  gateway: Gateway,
  tenant: string,
  input: { name: string; description: string },
): Promise<GatewayResult<Role>> {
  return adminCall(gateway, 'POST', tenant, ['roles'], {
    body: {
      name: input.name,
      ...(input.description === '' ? {} : { description: input.description }),
    },
    schema: roleSchema,
  });
}

export function amendRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
  changes: { description: string | null },
  ifMatch: string,
): Promise<GatewayResult<Role>> {
  return adminCall(gateway, 'PATCH', tenant, ['roles', roleId], {
    // The server keeps no empty description, so an emptied one is cleared.
    body: { description: changes.description === '' ? null : changes.description },
    ifMatch,
    schema: roleSchema,
  });
}

export function setRoleDefault(
  gateway: Gateway,
  tenant: string,
  roleId: string,
  value: boolean,
  ifMatch: string,
): Promise<GatewayResult<Role>> {
  return adminCall(gateway, 'PUT', tenant, ['roles', roleId, 'default'], {
    body: { default: value },
    ifMatch,
    schema: roleSchema,
  });
}

export function deleteRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['roles', roleId], { schema: nothing });
}

export function readComposites(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<Composites>> {
  return adminCall(gateway, 'GET', tenant, ['roles', roleId, 'composites'], {
    schema: listRoleCompositesResponseSchema,
  });
}

// Each answers the list's new ETag beside its 204. A copy nests into a role
// nobody else has seen yet, so it sends no If-Match.
export function addComposite(
  gateway: Gateway,
  tenant: string,
  roleId: string,
  childId: string,
  ifMatch: string | null,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'POST', tenant, ['roles', roleId, 'composites'], {
    body: { child_role_id: childId },
    ...(ifMatch === null ? {} : { ifMatch }),
    schema: nothing,
  });
}

export function removeComposite(
  gateway: Gateway,
  tenant: string,
  roleId: string,
  childId: string,
  ifMatch: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['roles', roleId, 'composites', childId], {
    ifMatch,
    schema: nothing,
  });
}

// The search is a prefix, so an exact match is picked out of its answer.
export async function findRole(
  gateway: Gateway,
  tenant: string,
  name: string,
): Promise<GatewayResult<Role | null>> {
  const query = new URLSearchParams({ name, client: 'tenant', limit: String(MAX_LIMIT) });
  const result = await readRolePage(gateway, tenant, query);
  return firstMatch(result, (role) => role.name === name);
}
