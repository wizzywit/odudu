import {
  listEffectiveRolesResponseSchema,
  setRequiredActionsResponseSchema,
  setSubjectGroupsResponseSchema,
  type ListEffectiveRolesResponse,
  type RequiredAction,
  type SetRequiredActionsResponse,
  type SetSubjectGroupsResponse,
} from '@odudu/contracts/admin';
import { readRolePage } from '#/shared/adapter/directory.ts';
import {
  ADMIN_CLIENT_KEY,
  isAdminRole,
  isHolding,
  type Holding,
} from '#/shared/service/capabilities.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

export function readSubjectGroups(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<SetSubjectGroupsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/groups`, {
    schema: setSubjectGroupsResponseSchema,
  });
}

export function setSubjectGroups(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  groupIds: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<SetSubjectGroupsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('PUT', `admin/tenants/${t}/subjects/${id}/groups`, {
    body: { group_ids: groupIds },
    ifMatch,
    schema: setSubjectGroupsResponseSchema,
  });
}

export function readRequiredActions(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<SetRequiredActionsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/required-actions`, {
    schema: setRequiredActionsResponseSchema,
  });
}

export function setRequiredActions(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  actions: readonly RequiredAction[],
  ifMatch: string,
): Promise<GatewayResult<SetRequiredActionsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('PUT', `admin/tenants/${t}/subjects/${id}/required-actions`, {
    body: { actions },
    ifMatch,
    schema: setRequiredActionsResponseSchema,
  });
}

export function readEffectiveRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<ListEffectiveRolesResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/effective-roles`, {
    schema: listEffectiveRolesResponseSchema,
  });
}

// Through the role list, which view-users reads, rather than the client
// list, which needs manage-clients: tenant-admin names the client, and the
// client's own page holds every capability.
export async function readAdminRoles(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ReadonlyMap<Holding, string>>> {
  const named = await readRolePage(gateway, tenant, new URLSearchParams({ name: 'tenant-admin' }));
  if (!named.ok) return named;
  const client = named.data.items.find(
    (role) => role.client_key === ADMIN_CLIENT_KEY && role.name === 'tenant-admin',
  )?.client_id;
  if (client === undefined || client === null) {
    console.error(`console defect: ${tenant} lists no tenant-admin of ${ADMIN_CLIENT_KEY}`);
    return { ok: false, kind: 'defect' };
  }
  const roles = await readRolePage(gateway, tenant, new URLSearchParams({ client, limit: '200' }));
  if (!roles.ok) return roles;
  const ids = new Map<Holding, string>();
  for (const role of roles.data.items) {
    if (isAdminRole(role) && isHolding(role.name)) ids.set(role.name, role.id);
  }
  return { ...roles, data: ids };
}
