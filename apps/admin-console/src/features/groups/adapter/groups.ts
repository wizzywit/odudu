import {
  countResponseSchema,
  groupRecordSchema,
  setGroupRolesResponseSchema,
  type CountResponse,
  type Group,
  type GroupRecord,
  type SetGroupRolesResponse,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import { readGroupPage } from '#/shared/adapter/directory.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

export { readGroupPage };

const nothing = z.undefined();

function path(tenant: string): string {
  return encodeURIComponent(tenant);
}

function segment(id: string): string {
  return encodeURIComponent(id);
}

export function readGroupCount(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  const t = path(tenant);
  return gateway.request('GET', `admin/tenants/${t}/groups/count?${query.toString()}`, {
    schema: countResponseSchema,
  });
}

export function createGroup(
  gateway: Gateway,
  tenant: string,
  input: { name: string; description: string; parentId: string | null },
): Promise<GatewayResult<GroupRecord>> {
  const t = path(tenant);
  return gateway.request('POST', `admin/tenants/${t}/groups`, {
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
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('GET', `admin/tenants/${t}/groups/${id}`, { schema: groupRecordSchema });
}

export function amendGroup(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  changes: { description?: string | null; parent_id?: string | null },
  ifMatch: string,
): Promise<GatewayResult<GroupRecord>> {
  const t = path(tenant);
  const id = segment(groupId);
  const { description, ...rest } = changes;
  return gateway.request('PATCH', `admin/tenants/${t}/groups/${id}`, {
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
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('PUT', `admin/tenants/${t}/groups/${id}/default`, {
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
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('DELETE', `admin/tenants/${t}/groups/${id}`, { schema: nothing });
}

export function readGroupRoles(
  gateway: Gateway,
  tenant: string,
  groupId: string,
): Promise<GatewayResult<SetGroupRolesResponse>> {
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('GET', `admin/tenants/${t}/groups/${id}/roles`, {
    schema: setGroupRolesResponseSchema,
  });
}

export function setGroupRoles(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  roleIds: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<SetGroupRolesResponse>> {
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('PUT', `admin/tenants/${t}/groups/${id}/roles`, {
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
  const query = new URLSearchParams({ name, parent: parentId ?? 'root', limit: '200' });
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
