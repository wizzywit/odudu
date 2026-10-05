import type { Group, GroupFields, SetSubjectGroupsResponse, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session';
import {
  useEffectiveRoles,
  useGroupsRecord,
  useSaveGroups,
  type GroupValues,
} from '#/features/subjects/repository/useAccess.ts';
import {
  accessRefusal,
  groupsRecord,
  groupsRemoveTenants,
  leaveConfirmation,
  leftGroups,
  membershipsOf,
  removalConfirmation,
  subjectName,
  type Confirmation,
  type Membership,
} from '#/features/subjects/service.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { describeIds } from '#/shared/service/format.ts';
import { sortedIds } from '#/shared/service/ids.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export function useSubjectGroupsRead(
  tenant: string,
  id: string,
): RecordState<SetSubjectGroupsResponse> {
  return useGroupsRecord(tenant, id);
}

export type { Membership };

export interface SubjectGroups {
  name: string;
  canManage: boolean;
  save: SectionSave<GroupValues>;
  choose: (ids: readonly string[]) => void;
  // Asked before you leave a group of your own, which may take capabilities.
  confirming: Confirmation | null;
  confirm: () => void;
  cancel: () => void;
  picker: PickerState<Group>;
  // What the section holds now, named from whatever has been read of each.
  members: readonly Membership[];
}

export function useSubjectGroups(
  tenant: string,
  subject: Subject,
  data: SetSubjectGroupsResponse,
  etag: string,
  gone: boolean,
  canManage: boolean,
  self: boolean,
): SubjectGroups {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const saveGroups = useSaveGroups(tenant, subject.id);
  const effective = useEffectiveRoles(tenant, subject.id);
  const picker = useGroupPicker(tenant);
  const known = new Map<string, GroupFields>(
    [...data.items, ...picker.options].map((group) => [group.id, group]),
  );
  const nameOf = (id: string): string => known.get(id)?.path ?? id;
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
    explain: accessRefusal(name, 'groups', self),
    fields: {
      group_ids: {
        value: sortedIds(data.items.map((group) => group.id)),
        label: 'Groups',
        kind: 'plain',
        describe: (value) => describeIds(value, nameOf),
      },
    },
    save: async (gateway, input) => {
      const result = await saveGroups(gateway, input);
      if (result.ok && self) reread();
      return result;
    },
  });
  const members = membershipsOf(save.values.group_ids, known);
  const left = leftGroups(data.items, save.values.group_ids);
  const removesTenants = groupsRemoveTenants(
    tenant,
    effective,
    data.items.map((group) => group.path),
    members.map((member) => member.path),
  );
  return {
    name,
    canManage,
    save: {
      ...save,
      submit: () => {
        if (removesTenants) {
          const asked = removalConfirmation({
            name,
            self,
            removed: ['manage-tenants'],
            removesTenants: true,
          });
          if (asked !== null) {
            setConfirming(asked);
            return true;
          }
        }
        const leaving = leaveConfirmation(self, left);
        if (leaving === null) return save.submit();
        setConfirming(leaving);
        return true;
      },
    },
    confirming,
    confirm: () => {
      setConfirming(null);
      save.submit();
    },
    cancel: () => {
      setConfirming(null);
    },
    choose: (value) => {
      save.edit('group_ids', sortedIds(value));
    },
    picker,
    members,
  };
}
