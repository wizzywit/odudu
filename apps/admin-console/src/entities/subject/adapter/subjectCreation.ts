import { issuePasswordResponseSchema, subjectSchema } from '@odudu/contracts/admin';
import { adminCall, firstMatch, mapResult } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { readSubjectPage } from '#/entities/subject/adapter/subjectList';
import { subjectOf } from '#/entities/subject/adapter/subjectWire';
import type { IssuedPassword, Subject } from '#/entities/subject/types/subject';

export async function createSubject(
  gateway: Gateway,
  tenant: string,
  input: { username: string; email: string },
): Promise<GatewayResult<Subject>> {
  const result = await adminCall(gateway, 'POST', tenant, ['subjects'], {
    body: { username: input.username, ...(input.email === '' ? {} : { email: input.email }) },
    schema: subjectSchema,
  });
  return mapResult(result, subjectOf);
}

// `username` is a prefix search, sorted by username: the exact one comes first.
export async function findSubject(
  gateway: Gateway,
  tenant: string,
  username: string,
): Promise<GatewayResult<Subject | null>> {
  const result = await readSubjectPage(gateway, tenant, new URLSearchParams({ username }));
  return firstMatch(result, (subject) => subject.username === username);
}

export function issuePassword(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<IssuedPassword>> {
  return adminCall(gateway, 'POST', tenant, ['subjects', subjectId, 'password'], {
    schema: issuePasswordResponseSchema,
  });
}
