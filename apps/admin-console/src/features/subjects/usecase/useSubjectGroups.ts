import type { Group, SetSubjectGroupsResponse, Subject } from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import {
  useGroupsRecord,
  useSaveGroups,
  type GroupValues,
} from '#/features/subjects/repository/useAccess.ts';
import { accessRefusal, groupsRecord, subjectName } from '#/features/subjects/service.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { lacking } from '#/shared/service/access.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export function useSubjectGroupsRead(
  tenant: string,
  id: string,
): RecordState<SetSubjectGroupsResponse> {
  return useGroupsRecord(tenant, id);
}

export interface Membership {
  id: string;
  // The path, or the id where the group is known by nothing else yet.
  path: string;
  description: string | null;
}

export interface SubjectGroups {
  name: string;
  canManage: boolean;
  save: SectionSave<GroupValues>;
  choose: (ids: readonly string[]) => void;
  picker: PickerState<Group>;
  // What the section holds now, named from whatever has been read of each.
  members: readonly Membership[];
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

export function useSubjectGroups(
  tenant: string,
  subject: Subject,
  data: SetSubjectGroupsResponse,
  etag: string,
  gone: boolean,
): SubjectGroups {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const canManage = lacking(useAuthority(tenant), ['manage-users']).length === 0;
  const picker = useGroupPicker(tenant);
  const known = new Map<string, Group>(
    [...data.items, ...picker.options].map((group) => [group.id, group]),
  );
  const describe = (value: unknown): string =>
    Array.isArray(value)
      ? value.map((id: unknown) => known.get(String(id))?.path ?? String(id)).join(', ') || 'none'
      : String(value);
  const save = useSectionSave({
    tenant,
    record: groupsRecord(subject.id),
    section: 'groups',
    label: 'Groups',
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    explain: accessRefusal(name, 'groups'),
    fields: {
      group_ids: {
        value: sorted(data.items.map((group) => group.id)),
        label: 'Groups',
        kind: 'plain',
        describe,
      },
    },
    save: useSaveGroups(tenant, subject.id),
  });
  return {
    name,
    canManage,
    save,
    choose: (value) => {
      save.edit('group_ids', sorted(value));
    },
    picker,
    members: save.values.group_ids.map((id) => {
      const group = known.get(id);
      return { id, path: group?.path ?? id, description: group?.description ?? null };
    }),
  };
}
