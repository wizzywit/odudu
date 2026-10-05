import type {
  EffectiveRoleAssignment,
  Role,
  SetRolesResponse,
  Subject,
} from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import { useEffectiveRoles, useSaveRoles } from '#/features/subjects/repository/useAccess.ts';
import type { Read } from '#/features/subjects/repository/useSubjectRead.ts';
import {
  accessRefusal,
  rolesRecord,
  splitRoles,
  subjectName,
} from '#/features/subjects/service.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { lacking } from '#/shared/service/access.ts';
import { isAdminRole } from '#/shared/service/capabilities.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export interface RoleValues extends Readonly<Record<string, unknown>> {
  role_ids: readonly string[];
}

export interface Assignment {
  id: string;
  name: string;
  // The client it belongs to, by its client_id, or null for a tenant role.
  client: string | null;
}

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

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

export function useSubjectRoles(
  tenant: string,
  subject: Subject,
  data: SetRolesResponse,
  etag: string,
  gone: boolean,
): SubjectRoles {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const canManage = lacking(useAuthority(tenant), ['manage-users']).length === 0;
  const picker = useRolePicker(tenant);
  const effective = useEffectiveRoles(tenant, subject.id);
  const saveRoles = useSaveRoles(tenant, subject.id);
  const split = splitRoles(data.items);
  const known = new Map<string, Assignment>(
    [...data.items, ...picker.options].map((role) => [
      role.id,
      { id: role.id, name: role.name, client: role.client_key },
    ]),
  );
  const describe = (value: unknown): string => {
    const ids = Array.isArray(value) ? value.map(String) : [];
    return ids.length === 0 ? 'none' : ids.map((id) => known.get(id)?.name ?? id).join(', ');
  };
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
      role_ids: { value: sorted(split.roleIds), label: 'Roles', kind: 'plain', describe },
    },
    save: (gateway, { values, ifMatch }) =>
      saveRoles(gateway, [...values.role_ids, ...split.adminIds], ifMatch),
  });
  return {
    name,
    canManage,
    save,
    choose: (value) => {
      save.edit('role_ids', sorted(value));
    },
    picker,
    unavailableOf: (role) =>
      isAdminRole(role) ? 'an admin capability: set it under Admin capabilities' : null,
    assigned: save.values.role_ids.map((id) => known.get(id) ?? { id, name: id, client: null }),
    effective,
  };
}
