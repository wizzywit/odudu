import {
  countResponseSchema,
  listRoleCompositesResponseSchema,
  roleSchema,
  type CountResponse,
  type ListRoleCompositesResponse,
  type Role,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import { readRolePage } from '#/shared/adapter/directory.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

export { readRolePage };

const nothing = z.undefined();

function path(tenant: string): string {
  return encodeURIComponent(tenant);
}

function segment(id: string): string {
  return encodeURIComponent(id);
}

export function readRoleCount(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  const t = path(tenant);
  return gateway.request('GET', `admin/tenants/${t}/roles/count?${query.toString()}`, {
    schema: countResponseSchema,
  });
}

// A tenant role: a client's own roles are made from that client's page.
export function createRole(
  gateway: Gateway,
  tenant: string,
  input: { name: string; description: string },
): Promise<GatewayResult<Role>> {
  const t = path(tenant);
  return gateway.request('POST', `admin/tenants/${t}/roles`, {
    body: {
      name: input.name,
      ...(input.description === '' ? {} : { description: input.description }),
    },
    schema: roleSchema,
  });
}

export function readRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<Role>> {
  const t = path(tenant);
  const id = segment(roleId);
  return gateway.request('GET', `admin/tenants/${t}/roles/${id}`, { schema: roleSchema });
}

export function amendRole(
  gateway: Gateway,
  tenant: string,
  roleId: string,
  changes: { description: string | null },
  ifMatch: string,
): Promise<GatewayResult<Role>> {
  const t = path(tenant);
  const id = segment(roleId);
  return gateway.request('PATCH', `admin/tenants/${t}/roles/${id}`, {
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
  const t = path(tenant);
  const id = segment(roleId);
  return gateway.request('PUT', `admin/tenants/${t}/roles/${id}/default`, {
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
  const t = path(tenant);
  const id = segment(roleId);
  return gateway.request('DELETE', `admin/tenants/${t}/roles/${id}`, { schema: nothing });
}

export function readComposites(
  gateway: Gateway,
  tenant: string,
  roleId: string,
): Promise<GatewayResult<ListRoleCompositesResponse>> {
  const t = path(tenant);
  const id = segment(roleId);
  return gateway.request('GET', `admin/tenants/${t}/roles/${id}/composites`, {
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
  const t = path(tenant);
  const id = segment(roleId);
  return gateway.request('POST', `admin/tenants/${t}/roles/${id}/composites`, {
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
  const t = path(tenant);
  const id = segment(roleId);
  const child = segment(childId);
  return gateway.request('DELETE', `admin/tenants/${t}/roles/${id}/composites/${child}`, {
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
  const query = new URLSearchParams({ name, client: 'tenant', limit: '200' });
  const result = await readRolePage(gateway, tenant, query);
  if (!result.ok) return result;
  return { ...result, data: result.data.items.find((role) => role.name === name) ?? null };
}
