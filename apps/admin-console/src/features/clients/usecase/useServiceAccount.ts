import type { Client, Role, SetRolesResponse } from '@odudu/contracts/admin';
import { subjectHref } from '#/features/subjects';
import { useAuthority, useRefusal } from '#/features/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import {
  useSaveServiceRoles,
  useServiceRolesRecord,
} from '#/features/clients/repository/useServiceAccount.ts';
import {
  assignedRoles,
  canChange,
  ceilingRefused,
  heldCapabilitiesText,
  nameIndex,
  roleNameOf,
  roleUnavailable,
  serviceAccess,
  serviceRolesRecord,
  SERVICE_CAPABILITY,
  SERVICE_SECTION,
  splitAssigned,
  type AssignedRole,
  type Reach,
  type ServiceAccess,
} from '#/features/clients/service';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { lacking } from '#/shared/service/access.ts';
import { writeRefusal } from '#/shared/service/capabilities';
import { describeIds } from '#/shared/service/format.ts';
import { sortedIds } from '#/shared/service/ids.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

export function useServiceAccess(tenant: string, client: Client): ServiceAccess {
  return serviceAccess(client, useAuthority(tenant));
}

export function useServiceRolesRead(
  tenant: string,
  subjectId: string,
): RecordState<SetRolesResponse> {
  return useServiceRolesRecord(tenant, subjectId);
}

export interface RoleValues extends Readonly<Record<string, unknown>> {
  role_ids: readonly string[];
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
  const caller = authority?.capabilities ?? [];
  const needs = lacking(authority, [SERVICE_CAPABILITY]);
  const split = splitAssigned(data.items);
  const known = nameIndex(data.items, picker.options);
  const save = useSectionSave({
    tenant,
    record: serviceRolesRecord(subjectId),
    section: SERVICE_SECTION,
    label: 'Roles',
    etag,
    capability: SERVICE_CAPABILITY,
    gone,
    onRefused: (failure) => {
      refusal.report(failure, SERVICE_CAPABILITY);
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
