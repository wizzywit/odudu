import type { Group, Role, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session/index.ts';
import { useOwnRoles } from '#/features/subjects/index.ts';
import {
  useGroupRolesRecord,
  useGroupSaves,
  type RoleValues,
} from '#/features/groups/repository/useGroupRecord.ts';
import { groupRolesRecord, roleUnavailable, selfLoss } from '#/features/groups/service.ts';
import type { Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import type { Asked } from '#/features/groups/usecase/useGroupGeneral.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { writeRefusal } from '#/shared/service/capabilities.ts';
import type { PickerState } from '#/shared/service/picker.ts';

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export function useGroupRolesRead(tenant: string, id: string): RecordState<SetGroupRolesResponse> {
  return useGroupRolesRecord(tenant, id);
}

export interface Mapped {
  id: string;
  name: string;
  // The client it belongs to, by its client_id, or null for a tenant role.
  client: string | null;
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
  group: Group;
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
          { id: role.id, name: role.name, client: role.client_key, description: null },
        ] as const,
    ),
    ...picker.options.map(
      (role) =>
        [
          role.id,
          { id: role.id, name: role.name, client: role.client_key, description: role.description },
        ] as const,
    ),
  ]);
  const caller = ceiling.status === 'ready' ? ceiling.caller : [];
  const why = (role: { name: string; client_key: string | null }): string | null =>
    roleUnavailable(role, caller, group.default_for_new_subjects, tenant);
  // A role mapped here that the caller could not give is one it cannot take.
  const kept = data.items
    .filter((role) => roleUnavailable(role, caller, false, tenant) !== null)
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
  const loss =
    own.status === 'ready' ? selfLoss(own.roles, { kind: 'roles', path: group.path, removed }) : [];
  return {
    save: {
      ...save,
      submit: () => {
        if (loss.length === 0) return save.submit();
        setAsking({
          title: 'Take roles your own access runs through?',
          consequence: `You hold ${AND.format(loss)} through ${group.path}. Taking it off the group may take it from you, and this console with it, unless you hold it some other way, and you may not be able to give it back yourself.`,
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
      (id) => known.get(id) ?? { id, name: id, client: null, description: null },
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
