import type { Group, GroupFields } from '#/entities/group';
import type { SetSubjectGroupsResponse } from '#/entities/subject';
import { useRefusal, useRereadAuthority } from '#/entities/session';
import { useGroupPicker } from '#/entities/group';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { describeIds } from '#/shared/lib/services/format';
import { indexById, sortedIds } from '#/shared/lib/services/ids';
import type { PickerState } from '#/shared/lib/services/picker';
import { useSaveConfirmation } from '#/shared/lib/use-cases/useSaveConfirmation';
import { accessRefusal, type Confirmation } from '#/shared/lib/services/capabilities';
import {
  groupsRemoveTenants,
  groupsSaveConfirmation,
} from '#/pages/subjects/services/membershipLoss';
import {
  groupPathOf,
  leftGroups,
  membershipsOf,
  type Membership,
} from '#/pages/subjects/services/groupMembership';
import {
  type Subject,
  useHeldCapabilities,
  useGroupsRecord,
  useSaveGroups,
  type GroupValues,
  subjectName,
  groupsRecord,
} from '#/entities/subject';

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
  const saveGroups = useSaveGroups(tenant, subject.id);
  const effective = useHeldCapabilities(tenant, subject.id);
  const picker = useGroupPicker(tenant);
  const known = indexById<GroupFields>(data.items, picker.options);
  const nameOf = (id: string): string => groupPathOf(known, id);
  const save = useSectionSave({
    tenant,
    record: groupsRecord(subject.id),
    section: 'groups',
    label: 'Groups',
    etag,
    capability: 'manage-users',
    gone,
    refusal,
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
  const asking = useSaveConfirmation<Confirmation>(save);
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
        return asking.submitOrAsk(groupsSaveConfirmation({ name, self, removesTenants, left }), {
          whenAsked: true,
        });
      },
    },
    confirming: asking.confirming,
    confirm: asking.confirm,
    cancel: asking.cancel,
    choose: (value) => {
      save.edit('group_ids', sortedIds(value));
    },
    picker,
    members,
  };
}
