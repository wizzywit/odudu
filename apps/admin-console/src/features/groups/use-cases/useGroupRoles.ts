import type { GroupRecord, Role, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/entities/session';
import { useOwnRoles } from '#/features/own-roles';
import { useGroupRolesRecord, useGroupSaves } from '#/features/groups/repository/useGroupRecord';
import { defaultingOf } from '#/features/groups/services/groupReach';
import { roleUnavailable } from '#/features/groups/services/groupRoles';
import { type GroupCeiling } from '#/features/groups/services/groupCeiling';
import { rolesConfirmation } from '#/features/groups/services/groupConfirmation';
import { lossOf } from '#/features/groups/services/groupLoss';
import { keptRoles, reachOfRoles } from '#/features/groups/services/groupRoles';
import { groupRolesRecord } from '#/features/groups/services/tabs';
import type { RecordState } from '#/shared/repository/useRecord';
import { useRolePicker } from '#/shared/repository/useRolePicker';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { type Asked, lossAction, lossBlocked, writeRefusal } from '#/shared/services/capabilities';
import { describeIds } from '#/shared/services/format';
import { removedFrom, sortedIds } from '#/shared/services/ids';
import type { PickerState } from '#/shared/services/picker';
import type { RoleValues } from '#/shared/services/sectionValues';
import {
  type MappedRole,
  mappedRoles,
  roleIndex,
  roleNameOf,
  withKept,
} from '#/shared/services/mappedRoles';
import { ceilingCaller } from '#/shared/services/access';

export function useGroupRolesRead(tenant: string, id: string): RecordState<SetGroupRolesResponse> {
  return useGroupRolesRecord(tenant, id);
}

export type { MappedRole };

export interface GroupRoles {
  save: SectionSave<RoleValues>;
  // Whether the picker is offered: what the ceiling needs has been read.
  offered: boolean;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  mapped: readonly MappedRole[];
  // Mapped roles this caller may not take away, each kept by every save.
  kept: readonly string[];
  asking: Asked | null;
  confirm: () => void;
  cancel: () => void;
}

export function useGroupRoles({
  tenant,
  group,
  data,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  group: GroupRecord;
  data: SetGroupRolesResponse;
  etag: string;
  gone: boolean;
  ceiling: GroupCeiling;
}): GroupRoles {
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const picker = useRolePicker(tenant);
  const saves = useGroupSaves(tenant, group.id);
  const [asking, setAsking] = useState<Asked | null>(null);
  const known = roleIndex(data.items, picker.options);
  const caller = ceilingCaller(ceiling);
  const why = (role: Role): string | null =>
    roleUnavailable(role, caller, defaultingOf(group), tenant);
  // A role mapped here that the caller could not give is one it cannot take.
  const kept = keptRoles(data.items, caller, tenant);
  const save = useSectionSave({
    tenant,
    record: groupRolesRecord(group.id),
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
    save: async (gateway, input) => {
      const result = await saves.roles(gateway, input);
      if (result.ok) reread();
      return result;
    },
  });
  const removed = removedFrom(
    data.items.map((role) => role.id),
    save.values.role_ids,
  );
  const loss = lossOf(
    own,
    caller,
    { kind: 'roles', path: group.path, removed },
    reachOfRoles(data.items, removed),
  );
  return {
    save: {
      ...save,
      blocked: lossBlocked(loss) ?? save.blocked,
      submit: () => {
        const action = lossAction(loss);
        if (action === 'wait') return false;
        if (action === 'run') return save.submit();
        setAsking(rolesConfirmation(group.path, loss));
        return true;
      },
    },
    offered: ceiling.status === 'ready',
    picker,
    unavailableOf: why,
    choose: (ids) => {
      save.edit('role_ids', withKept(ids, kept));
    },
    mapped: mappedRoles(save.values.role_ids, known),
    kept,
    asking,
    confirm: () => {
      setAsking(null);
      save.submit();
    },
    cancel: () => {
      setAsking(null);
    },
  };
}
