import {
  countResponseSchema,
  groupSchema,
  setGroupRolesResponseSchema,
  type CountResponse,
  type Group,
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
): Promise<GatewayResult<Group>> {
  const t = path(tenant);
  return gateway.request('POST', `admin/tenants/${t}/groups`, {
    body: {
      name: input.name,
      ...(input.description === '' ? {} : { description: input.description }),
      ...(input.parentId === null ? {} : { parent_id: input.parentId }),
    },
    schema: groupSchema,
  });
}

export function readGroup(
  gateway: Gateway,
  tenant: string,
  groupId: string,
): Promise<GatewayResult<Group>> {
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('GET', `admin/tenants/${t}/groups/${id}`, { schema: groupSchema });
}

export function amendGroup(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  changes: { description?: string | null; parent_id?: string | null },
  ifMatch: string,
): Promise<GatewayResult<Group>> {
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('PATCH', `admin/tenants/${t}/groups/${id}`, {
    body: changes,
    ifMatch,
    schema: groupSchema,
  });
}

export function setGroupDefault(
  gateway: Gateway,
  tenant: string,
  groupId: string,
  value: boolean,
  ifMatch: string,
): Promise<GatewayResult<Group>> {
  const t = path(tenant);
  const id = segment(groupId);
  return gateway.request('PUT', `admin/tenants/${t}/groups/${id}/default`, {
    body: { default: value },
    ifMatch,
    schema: groupSchema,
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

export interface TrailStep {
  group: Group;
  roles: SetGroupRolesResponse['items'];
}

// A group and every group above it, the topmost first, each with the roles
// it hands to the members of every group beneath it.
export async function readGroupTrail(
  gateway: Gateway,
  tenant: string,
  groupId: string,
): Promise<GatewayResult<TrailStep[]>> {
  const steps: TrailStep[] = [];
  let next: string | null = groupId;
  while (next !== null) {
    const [group, roles]: [GatewayResult<Group>, GatewayResult<SetGroupRolesResponse>] =
      await Promise.all([readGroup(gateway, tenant, next), readGroupRoles(gateway, tenant, next)]);
    if (!group.ok) return group;
    if (!roles.ok) return roles;
    steps.unshift({ group: group.data, roles: roles.data.items });
    next = group.data.parent_id;
  }
  return { ok: true, status: 200, etag: null, next: null, data: steps };
}

// The search is a prefix, so an exact match is picked out of its answer.
export async function findGroup(
  gateway: Gateway,
  tenant: string,
  name: string,
  parentId: string | null,
): Promise<GatewayResult<Group | null>> {
  const query = new URLSearchParams({ name, parent: parentId ?? 'root', limit: '200' });
  const result = await readGroupPage(gateway, tenant, query);
  if (!result.ok) return result;
  return { ...result, data: result.data.items.find((group) => group.name === name) ?? null };
}
