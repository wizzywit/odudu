import type { ClientScope, Role, SetScopeRolesResponse } from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/entities/session';
import { useScopeRolesRecord, useScopeSaves } from '#/features/scopes/repository/useScopeRecord';
import { scopeRolesRecord } from '#/features/scopes/services/tabs';
import type { RecordState } from '#/shared/repository/useRecord';
import {
  useRolePicker,
  type MappedRole,
  keptRoles,
  mappedRoles,
  roleIndex,
  roleNameOf,
  withKept,
} from '#/entities/role';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { roleReachUnavailable, writeRefusal } from '#/shared/services/capabilities';
import { describeIds } from '#/shared/services/format';
import { sortedIds } from '#/shared/services/ids';
import type { PickerState } from '#/shared/services/picker';
import { callerCapabilities } from '#/shared/services/access';
import type { RoleValues } from '#/shared/services/sectionValues';

export function useScopeRolesRead(tenant: string, id: string): RecordState<SetScopeRolesResponse> {
  return useScopeRolesRecord(tenant, id);
}

export interface ScopeRoles {
  save: SectionSave<RoleValues>;
  // Whether the picker is offered: what the ceiling needs has been read.
  offered: boolean;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  mapped: readonly MappedRole[];
  // Mapped roles this caller may not take away, each kept by every save.
  kept: readonly string[];
}

export function useScopeRoles({
  tenant,
  scope,
  data,
  etag,
  gone,
}: {
  tenant: string;
  scope: ClientScope;
  data: SetScopeRolesResponse;
  etag: string;
  gone: boolean;
}): ScopeRoles {
  const refusal = useRefusal(tenant);
  const authority = useAuthority(tenant);
  const picker = useRolePicker(tenant);
  const saves = useScopeSaves(tenant, scope.id);
  const known = roleIndex(data.items, picker.options);
  const caller = callerCapabilities(authority);
  const kept = keptRoles(data.items, caller, tenant);
  const save = useSectionSave({
    tenant,
    record: scopeRolesRecord(scope.id),
    section: 'roles',
    label: 'Roles',
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      role_ids: {
        value: sortedIds(data.items.map((role) => role.id)),
        label: 'Roles',
        kind: 'plain',
        describe: (value) => describeIds(value, roleNameOf(known)),
      },
    },
    save: saves.roles,
  });
  return {
    save,
    offered: authority !== undefined,
    picker,
    unavailableOf: (role) => roleReachUnavailable(role, caller, tenant),
    choose: (ids) => {
      save.edit('role_ids', withKept(ids, kept));
    },
    mapped: mappedRoles(save.values.role_ids, known),
    kept,
  };
}
