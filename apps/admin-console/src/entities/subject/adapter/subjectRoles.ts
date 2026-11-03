import { setRolesResponseSchema, type SetRolesResponse } from '@odudu/contracts/admin';
import { adminCall } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

export function readSubjectRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<SetRolesResponse>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'roles'], {
    schema: setRolesResponseSchema,
  });
}

export function setSubjectRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  roleIds: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<SetRolesResponse>> {
  return adminCall(gateway, 'PUT', tenant, ['subjects', subjectId, 'roles'], {
    body: { role_ids: roleIds },
    ifMatch,
    schema: setRolesResponseSchema,
  });
}
