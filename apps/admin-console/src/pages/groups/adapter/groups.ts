import { groupRecordSchema, MAX_LIMIT, setGroupRolesResponseSchema } from '@odudu/contracts/admin';
import { readGroupPage } from '#/shared/adapter/directory';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, countReader, nothing } from '#/shared/adapter/route';
import type { Group, GroupRecord } from '#/entities/group';
import type { GroupRoleList } from '#/pages/groups/types/groupRoles';

export { readGroupPage };

export const readGroupCount = countReader('groups');

export function createGroup(
  gateway: Gateway,
  tenant: string,
  input: { name: string; description: string; parentId: string | null },
): Promise<GatewayResult<GroupRecord>> {
  return adminCall(gateway, 'POST', tenant, ['groups'], {
    body: {
      name: input.name,
      ...(input.description === '' ? {} : { description: input.description }),
      ...(input.parentId === null ? {} : { parent_id: input.parentId }),
    },
    schema: groupRecordSchema,
  });
}

export function readGroup(
  gateway: Gateway,
  tenant: string,
  groupId: string,
): Promise<GatewayResult<GroupRecord>> {
  return adminCall(gateway, 'GET', tenant, ['groups', groupId], { schema: groupRecordSchema });
}

export function amendGroup(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  changes: { description?: string | null; parent_id?: string | null },
  ifMatch: string,
): Promise<GatewayResult<GroupRecord>> {
  const { description, ...rest } = changes;
  return adminCall(gateway, 'PATCH', tenant, ['groups', groupId], {
    // The server keeps no empty description, so an emptied one is cleared.
    body:
      description === undefined
        ? rest
        : { ...rest, description: description === '' ? null : description },
    ifMatch,
    schema: groupRecordSchema,
  });
}

export function setGroupDefault(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  value: boolean,
  ifMatch: string,
): Promise<GatewayResult<GroupRecord>> {
  return adminCall(gateway, 'PUT', tenant, ['groups', groupId, 'default'], {
    body: { default: value },
    ifMatch,
    schema: groupRecordSchema,
  });
}

export function deleteGroup(
  gateway: Gateway,
  tenant: string,
  groupId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['groups', groupId], { schema: nothing });
}

export function readGroupRoles(
  gateway: Gateway,
  tenant: string,
  groupId: string,
): Promise<GatewayResult<GroupRoleList>> {
  return adminCall(gateway, 'GET', tenant, ['groups', groupId, 'roles'], {
    schema: setGroupRolesResponseSchema,
  });
}

export function setGroupRoles(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  roleIds: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<GroupRoleList>> {
  return adminCall(gateway, 'PUT', tenant, ['groups', groupId, 'roles'], {
    body: { role_ids: roleIds },
    ifMatch,
    schema: setGroupRolesResponseSchema,
  });
}

// The search is a prefix, sorted by the folded name, so the exact match is
// picked out page by page until the names run past it.
export async function findGroup(
  gateway: Gateway,
  tenant: string,
  name: string,
  parentId: string | null,
): Promise<GatewayResult<Group | null>> {
  const folded = name.toLowerCase();
  const query = new URLSearchParams({ name, parent: parentId ?? 'root', limit: String(MAX_LIMIT) });
  for (;;) {
    const result = await readGroupPage(gateway, tenant, query);
    if (!result.ok) return result;
    const found = result.data.items.find((group) => group.name === name);
    const last = result.data.items.at(-1)?.name.toLowerCase() ?? folded;
    if (found !== undefined || result.data.next === undefined || last > folded) {
      return { ...result, data: found ?? null };
    }
    query.set('cursor', result.data.next);
  }
}
