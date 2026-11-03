import type { EffectiveRoleAssignment, Role, SetRolesResponse } from '@odudu/contracts/admin';
import { useRefusal } from '#/entities/session';
import { useRolePicker } from '#/shared/repository/useRolePicker';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { describeIds } from '#/shared/services/format';
import { sortedIds } from '#/shared/services/ids';
import {
  assignmentsOf,
  knownAssignments,
  roleNameOf,
  type AssignedRole,
} from '#/shared/services/mappedRoles';
import type { PickerState } from '#/shared/services/picker';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { RoleValues } from '#/shared/services/sectionValues';
import { accessRefusal } from '#/shared/services/capabilities';
import {
  type Subject,
  useEffectiveRoleList,
  useSaveRoles,
  subjectName,
  rolesRecord,
  roleUnavailableHere,
  splitRoles,
} from '#/entities/subject';

export interface SubjectRoles {
  name: string;
  canManage: boolean;
  save: SectionSave<RoleValues>;
  choose: (ids: readonly string[]) => void;
  picker: PickerState<Role>;
  // Why a role is not chosen here: an admin capability has its own section.
  unavailableOf: (role: Role) => string | null;
  assigned: readonly AssignedRole[];
  effective: ResourceListState<EffectiveRoleAssignment>;
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
  const effective = useEffectiveRoleList(tenant, subject.id);
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
    refusal,
    explain: accessRefusal(name, 'roles'),
    fields: {
      role_ids: {
        value: sortedIds(split.roleIds),
        label: 'Roles',
        kind: 'plain',
        describe: (value) => describeIds(value, roleNameOf(known)),
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
