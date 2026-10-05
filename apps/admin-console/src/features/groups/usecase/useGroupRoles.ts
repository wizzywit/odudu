import type { GroupRecord, Role, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session';
import { useOwnRoles } from '#/features/subjects';
import {
  useGroupRolesRecord,
  useGroupSaves,
  type RoleValues,
} from '#/features/groups/repository/useGroupRecord.ts';
import {
  type Asked,
  type Ceiling,
  defaultingOf,
  groupRolesRecord,
  keptRoles,
  lossOf,
  type Mapped,
  mappedRoles,
  reachOfRoles,
  roleIndex,
  rolesConfirmation,
  roleUnavailable,
  withKept,
} from '#/features/groups/service';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { asksFirst, lossBlocked, writeRefusal } from '#/shared/service/capabilities.ts';
import { describeIds } from '#/shared/service/format.ts';
import { removedFrom, sortedIds } from '#/shared/service/ids.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export function useGroupRolesRead(tenant: string, id: string): RecordState<SetGroupRolesResponse> {
  return useGroupRolesRecord(tenant, id);
}

export type { Mapped };

export interface GroupRoles {
  save: SectionSave<RoleValues>;
  // Whether the picker is offered: what the ceiling needs has been read.
  offered: boolean;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  mapped: readonly Mapped[];
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
  ceiling: Ceiling;
}): GroupRoles {
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const picker = useRolePicker(tenant);
  const saves = useGroupSaves(tenant, group.id);
  const [asking, setAsking] = useState<Asked | null>(null);
  const known = roleIndex(data.items, picker.options);
  const caller = ceiling.status === 'ready' ? ceiling.caller : [];
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
    onRefused: (failure) => {
      refusal.report(failure, 'manage-tenant');
    },
    explain: writeRefusal,
    fields: {
      role_ids: {
        value: sortedIds(data.items.map((role) => role.id)),
        label: 'Roles',
        kind: 'plain',
        describe: (value) => describeIds(value, (id) => known.get(id)?.name ?? id),
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
        if (loss.kind === 'checking') return false;
        if (!asksFirst(loss)) return save.submit();
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
