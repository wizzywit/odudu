import type {
  EffectiveRoleAssignment,
  Role,
  SetRolesResponse,
  Subject,
} from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { useEffectiveRoles, useSaveRoles } from '#/features/subjects/repository/useAccess.ts';
import type { Read } from '#/features/subjects/repository/useSubjectRead.ts';
import {
  accessRefusal,
  assignmentsOf,
  knownAssignments,
  roleUnavailableHere,
  rolesRecord,
  splitRoles,
  subjectName,
  type Assignment,
} from '#/features/subjects/service';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { describeIds } from '#/shared/service/format.ts';
import { sortedIds } from '#/shared/service/ids.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export interface RoleValues extends Readonly<Record<string, unknown>> {
  role_ids: readonly string[];
}

export type { Assignment };

export interface SubjectRoles {
  name: string;
  canManage: boolean;
  save: SectionSave<RoleValues>;
  choose: (ids: readonly string[]) => void;
  picker: PickerState<Role>;
  // Why a role is not chosen here: an admin capability has its own section.
  unavailableOf: (role: Role) => string | null;
  assigned: readonly Assignment[];
  effective: Read<{ items: EffectiveRoleAssignment[] }>;
}

export function useSubjectRoles(
  tenant: string,
  subject: Subject,
  data: SetRolesResponse,
  etag: string,
  gone: boolean,
  canManage: boolean,
): SubjectRoles {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const picker = useRolePicker(tenant);
  const effective = useEffectiveRoles(tenant, subject.id);
  const saveRoles = useSaveRoles(tenant, subject.id);
  const split = splitRoles(data.items);
  const known = knownAssignments(data.items, picker.options);
  const save = useSectionSave({
    tenant,
    record: rolesRecord(subject.id),
    section: 'roles',
    label: 'Roles',
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    explain: accessRefusal(name, 'roles'),
    fields: {
      role_ids: {
        value: sortedIds(split.roleIds),
        label: 'Roles',
        kind: 'plain',
        describe: (value) => describeIds(value, (id) => known.get(id)?.name ?? id),
      },
    },
    save: (gateway, { values, ifMatch }) =>
      saveRoles(gateway, [...values.role_ids, ...split.adminIds], ifMatch),
  });
  return {
    name,
    canManage,
    save,
    choose: (value) => {
      save.edit('role_ids', sortedIds(value));
    },
    picker,
    unavailableOf: roleUnavailableHere,
    assigned: assignmentsOf(save.values.role_ids, known),
    effective,
  };
}
