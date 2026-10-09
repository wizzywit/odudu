import type { SetRolesResponse } from '@odudu/contracts/admin';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import { serviceRolesRecord } from '#/features/clients/service';
import { readSubjectRoles, setSubjectRoles } from '#/shared/adapter/administrators.ts';
import { useRecord, type RecordState } from '#/shared/repository/useRecord.ts';
import { uniqueIds } from '#/shared/service/ids.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';

export function useServiceRolesRecord(
  tenant: string,
  subjectId: string,
): RecordState<SetRolesResponse> {
  return useRecord({
    tenant,
    record: serviceRolesRecord(subjectId),
    read: (gateway) => readSubjectRoles(gateway, tenant, subjectId),
  });
}

// What the service account holds decides the client's own ceiling, so the
// client's record is read again once its roles change.
export function useSaveServiceRoles(tenant: string, clientDbId: string, subjectId: string) {
  const reread = useRereadClient(tenant, clientDbId);
  return async (gateway: Gateway, roleIds: readonly string[], ifMatch: string) => {
    const result = await setSubjectRoles(gateway, tenant, subjectId, uniqueIds(roleIds), ifMatch);
    if (result.ok) reread();
    return result;
  };
}
