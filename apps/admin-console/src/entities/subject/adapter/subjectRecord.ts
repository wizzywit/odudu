import { subjectSchema } from '@odudu/contracts/admin';
import { adminCall, mapResult, nothing } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { subjectOf } from '#/entities/subject/adapter/subjectWire';
import type { Subject, SubjectChanges } from '#/entities/subject/types/subject';

export async function readSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Subject>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', subjectId], {
    schema: subjectSchema,
  });
  return mapResult(result, subjectOf);
}

export async function amendSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  changes: SubjectChanges,
  ifMatch: string,
): Promise<GatewayResult<Subject>> {
  const result = await adminCall(gateway, 'PATCH', tenant, ['subjects', subjectId], {
    // The server keeps no empty email, so an emptied one is cleared.
    body: changes.email === '' ? { ...changes, email: null } : changes,
    ifMatch,
    schema: subjectSchema,
  });
  return mapResult(result, subjectOf);
}

export function deleteSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId], { schema: nothing });
}
