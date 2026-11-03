import {
  adminCapabilitiesResponseSchema,
  listEffectiveRolesResponseSchema,
  MAX_LIMIT,
  setRequiredActionsResponseSchema,
  setSubjectGroupsResponseSchema,
  type AdminCapabilitiesResponse,
  type ListEffectiveRolesResponse,
  type RequiredAction,
  type SetRequiredActionsResponse,
  type SetSubjectGroupsResponse,
} from '@odudu/contracts/admin';
import { readRolePage } from '#/shared/adapter/directory';
import {
  ADMIN_CLIENT_KEY,
  adminClientOfRoles,
  holdingRoleIds,
  type Holding,
} from '#/shared/services/capabilities';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall } from '#/shared/adapter/route';

export function readSubjectGroups(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<SetSubjectGroupsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'groups'], {
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
  return adminCall(gateway, 'PUT', tenant, ['subjects', subjectId, 'groups'], {
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
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'required-actions'], {
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
  return adminCall(gateway, 'PUT', tenant, ['subjects', subjectId, 'required-actions'], {
    body: { actions },
    ifMatch,
    schema: setRequiredActionsResponseSchema,
  });
}

export function readEffectiveRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListEffectiveRolesResponse>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'effective-roles'], {
    query,
    schema: listEffectiveRolesResponseSchema,
  });
}

// The admin capabilities a subject holds, whole: what every judgement of its
// reach reads, never a page of the roles it holds.
export async function readAdminCapabilities(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<AdminCapabilitiesResponse>> {
  const read = await adminCall(
    gateway,
    'GET',
    tenant,
    ['subjects', subjectId, 'admin-capabilities'],
    { schema: adminCapabilitiesResponseSchema },
  );
  // More carriers than the server returns: nothing may be judged from part of them.
  if (read.ok && !read.data.complete) {
    console.error(`console defect: ${subjectId} of ${tenant} has more carriers than are returned`);
    return { ok: false, kind: 'defect' };
  }
  return read;
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
  const client = adminClientOfRoles(named.data.items);
  if (client === null) {
    console.error(`console defect: ${tenant} lists no tenant-admin of ${ADMIN_CLIENT_KEY}`);
    return { ok: false, kind: 'defect' };
  }
  const roles = await readRolePage(
    gateway,
    tenant,
    new URLSearchParams({ client, limit: String(MAX_LIMIT) }),
  );
  if (!roles.ok) return roles;
  return { ...roles, data: holdingRoleIds(roles.data.items) };
}
