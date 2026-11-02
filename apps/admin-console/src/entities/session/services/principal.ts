import { type Principal } from '#/entities/session/types/principal';

export function isOwnTenant(principal: Principal, tenant: string): boolean {
  return principal.tenant === tenant;
}

export function isSelf(principal: Principal, tenant: string, subjectId: string): boolean {
  return isOwnTenant(principal, tenant) && principal.subjectId === subjectId;
}
