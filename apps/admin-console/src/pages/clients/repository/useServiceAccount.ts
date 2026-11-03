import type { SetRolesResponse } from '@odudu/contracts/admin';
import { useRereadClient } from '#/pages/clients/repository/useClientRecord';
import { serviceRolesRecord } from '#/pages/clients/services/serviceAccess';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';
import { uniqueIds } from '#/shared/lib/services/ids';
import type { Gateway } from '#/shared/api/transport/gateway';
import { readSubjectRoles, setSubjectRoles } from '#/entities/subject';

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
