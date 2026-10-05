import type { GroupRecord, Role, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session/index.ts';
import { useOwnRoles } from '#/features/subjects/index.ts';
import {
  useGroupRolesRecord,
  useGroupSaves,
  type RoleValues,
} from '#/features/groups/repository/useGroupRecord.ts';
import {
  defaultingOf,
  groupRolesRecord,
  lossOf,
  lossText,
  roleUnavailable,
} from '#/features/groups/service.ts';
import type { Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import type { Asked } from '#/features/groups/usecase/useGroupGeneral.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { writeRefusal } from '#/shared/service/capabilities.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export function useGroupRolesRead(tenant: string, id: string): RecordState<SetGroupRolesResponse> {
  return useGroupRolesRecord(tenant, id);
}

export interface Mapped {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  description: string | null;
}

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

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
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
  const known = new Map<string, Mapped>([
    ...data.items.map(
      (role) =>
        [
          role.id,
          {
            id: role.id,
            name: role.name,
            client_id: role.client_id,
            client_key: role.client_key,
            description: null,
          },
        ] as const,
    ),
    ...picker.options.map(
      (role) =>
        [
          role.id,
          {
            id: role.id,
            name: role.name,
            client_id: role.client_id,
            client_key: role.client_key,
            description: role.description,
          },
        ] as const,
    ),
  ]);
  const caller = ceiling.status === 'ready' ? ceiling.caller : [];
  const reachOf = (id: string): readonly string[] =>
    data.items.find((role) => role.id === id)?.admin_reach ?? [];
  const why = (role: Role): string | null =>
    roleUnavailable(role, caller, defaultingOf(group), tenant);
  // A role mapped here that the caller could not give is one it cannot take.
  const kept = data.items
    .filter((role) => roleUnavailable(role, caller, null, tenant) !== null)
    .map((role) => role.id);
  const describe = (value: unknown): string => {
    const ids = Array.isArray(value) ? value.map(String) : [];
    return ids.length === 0 ? 'none' : ids.map((id) => known.get(id)?.name ?? id).join(', ');
  };
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
        value: sorted(data.items.map((role) => role.id)),
        label: 'Roles',
        kind: 'plain',
        describe,
      },
    },
    save: async (gateway, input) => {
      const result = await saves.roles(gateway, input);
      if (result.ok) reread();
      return result;
    },
  });
  const removed = data.items
    .map((role) => role.id)
    .filter((id) => !save.values.role_ids.includes(id));
  const loss = lossOf(
    own,
    caller,
    { kind: 'roles', path: group.path, removed },
    removed.flatMap(reachOf),
  );
  return {
    save: {
      ...save,
      blocked: loss.kind === 'checking' ? 'Checking what this takes from you first.' : save.blocked,
      submit: () => {
        if (loss.kind === 'checking') return false;
        if (loss.kind === 'none') return save.submit();
        setAsking({
          title: 'Take roles your own access runs through?',
          consequence: `Taking them off the group takes them from its members.${lossText(loss, group.path)} You may not be able to give it back yourself.`,
        });
        return true;
      },
    },
    offered: ceiling.status === 'ready',
    picker,
    unavailableOf: why,
    choose: (ids) => {
      save.edit('role_ids', sorted([...new Set([...ids, ...kept])]));
    },
    mapped: save.values.role_ids.map(
      (id) =>
        known.get(id) ?? { id, name: id, client_id: null, client_key: null, description: null },
    ),
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
