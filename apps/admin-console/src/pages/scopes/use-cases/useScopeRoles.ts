import type { Scope } from '#/entities/scope';
import type { ScopeRoleList } from '#/pages/scopes/types/scopeRoles';
import { useAuthority } from '#/entities/session';
import { useScopeRolesRecord, useScopeSaves } from '#/pages/scopes/repository/useScopeRecord';
import { INCLUDE_ALL_POINTER, NO_ROLES_MAPPED } from '#/pages/scopes/services/scopeRoles';
import { scopeRolesRecord } from '#/pages/scopes/services/tabs';
import { useRoleMapping, type RoleMappingModel } from '#/features/role-mapping';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { roleReachUnavailable } from '#/shared/lib/services/capabilities';
import { callerCapabilities } from '#/shared/lib/services/access';

export function useScopeRolesRead(tenant: string, id: string): RecordState<ScopeRoleList> {
  return useScopeRolesRecord(tenant, id);
}

export interface ScopeRoles extends RoleMappingModel {
  // What to say when no role is mapped.
  empty: string;
  // Where the switch for including all roles lives.
  pointer: string;
}

export function useScopeRoles({
  tenant,
  scope,
  data,
  etag,
  gone,
}: {
  tenant: string;
  scope: Scope;
  data: ScopeRoleList;
  etag: string;
  gone: boolean;
}): ScopeRoles {
  const authority = useAuthority(tenant);
  const saves = useScopeSaves(tenant, scope.id);
  const caller = callerCapabilities(authority);
  const mapping = useRoleMapping({
    tenant,
    record: scopeRolesRecord(scope.id),
    etag,
    gone,
    items: data.items,
    caller,
    offered: authority !== undefined,
    unavailableOf: (role) => roleReachUnavailable(role, caller, tenant),
    reachFrom: 'picker',
    saveRoles: saves.roles,
  });
  return {
    save: mapping.save,
    offered: mapping.offered,
    picker: mapping.picker,
    unavailableOf: mapping.unavailableOf,
    choose: mapping.choose,
    mapped: mapping.mapped,
    kept: mapping.kept,
    empty: NO_ROLES_MAPPED,
    pointer: INCLUDE_ALL_POINTER,
  };
}
