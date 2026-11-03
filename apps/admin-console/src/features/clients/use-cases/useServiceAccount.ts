import type { Client, Role, SetRolesResponse } from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/entities/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord';
import {
  useSaveServiceRoles,
  useServiceRolesRecord,
} from '#/features/clients/repository/useServiceAccount';
import {
  accountIdleNote,
  heldCapabilitiesText,
  roleUnavailable,
  serviceAccess,
  serviceRolesRecord,
  SERVICE_CAPABILITY,
  splitAssigned,
  type ServiceAccess,
} from '#/features/clients/services/account';
import { canChange, type Reach } from '#/features/clients/services/ceiling';
import { ceilingRefused } from '#/features/clients/services/refusal';
import { SERVICE_SECTION } from '#/features/clients/services/tabs';
import type { RecordState } from '#/shared/repository/useRecord';
import {
  assignedRoles,
  knownAssignments,
  roleNameOf,
  useRolePicker,
  type AssignedRole,
} from '#/entities/role';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { callerCapabilities, lacking } from '#/shared/services/access';
import { writeRefusal } from '#/shared/services/capabilities';
import { describeIds } from '#/shared/services/format';
import { sortedIds } from '#/shared/services/ids';
import type { PickerState } from '#/shared/services/picker';
import type { AdminCapability } from '#/shared/services/principal';
import type { RoleValues } from '#/shared/services/sectionValues';
import { subjectHref } from '#/entities/subject';

// The tab's access, and the note for an account the client no longer uses.
export function useServiceAccess(
  tenant: string,
  client: Client,
): ServiceAccess & { idle: string | null } {
  return { ...serviceAccess(client, useAuthority(tenant)), idle: accountIdleNote(client) };
}

export function useServiceRolesRead(
  tenant: string,
  subjectId: string,
): RecordState<SetRolesResponse> {
  return useServiceRolesRecord(tenant, subjectId);
}

export interface ServiceRoles {
  // Whether the roles can be changed: the ceiling on the account is judged
  // and holds nothing back.
  offered: boolean;
  needs: readonly AdminCapability[];
  accountHref: string;
  save: SectionSave<RoleValues>;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  assigned: readonly AssignedRole[];
  // The admin capabilities it holds, which a save here keeps.
  kept: string | null;
}

export function useServiceRoles({
  tenant,
  client,
  subjectId,
  data,
  etag,
  gone,
  reach,
}: {
  tenant: string;
  client: Client;
  subjectId: string;
  data: SetRolesResponse;
  etag: string;
  gone: boolean;
  reach: Reach;
}): ServiceRoles {
  const authority = useAuthority(tenant);
  const refusal = useRefusal(tenant);
  const reread = useRereadClient(tenant, client.id);
  const picker = useRolePicker(tenant);
  const saveRoles = useSaveServiceRoles(tenant, client.id, subjectId);
  const caller = callerCapabilities(authority);
  const needs = lacking(authority, [SERVICE_CAPABILITY]);
  const split = splitAssigned(data.items);
  const known = knownAssignments(data.items, picker.options);
  const save = useSectionSave({
    tenant,
    record: serviceRolesRecord(subjectId),
    section: SERVICE_SECTION,
    label: 'Roles',
    etag,
    capability: SERVICE_CAPABILITY,
    gone,
    refusal,
    onRefused: (failure) => {
      if (ceilingRefused(failure)) reread();
    },
    explain: (problem) => writeRefusal(problem, SERVICE_CAPABILITY),
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
    offered: canChange(reach, needs),
    needs,
    accountHref: subjectHref(tenant, subjectId),
    save,
    picker,
    unavailableOf: (role) => roleUnavailable(role, caller),
    choose: (ids) => {
      save.edit('role_ids', sortedIds(ids));
    },
    assigned: assignedRoles(save.values.role_ids, known),
    kept: heldCapabilitiesText(data.items),
  };
}
