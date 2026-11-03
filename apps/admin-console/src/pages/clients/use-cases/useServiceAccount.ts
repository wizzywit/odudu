import type { Role, SetRolesResponse } from '@odudu/contracts/admin';
import type { Client } from '#/entities/client';
import { useAuthority, useRefusal } from '#/entities/session';
import { useRereadClient } from '#/pages/clients/repository/useClientRecord';
import {
  useSaveServiceRoles,
  useServiceRolesRecord,
} from '#/pages/clients/repository/useServiceAccount';
import {
  accountIdleNote,
  serviceAccess,
  serviceRolesRecord,
  SERVICE_CAPABILITY,
  SERVICE_RULE,
  type ServiceAccess,
} from '#/pages/clients/services/serviceAccess';
import { roleOwnerLine } from '#/pages/clients/services/clientRoles';
import {
  assignedCount,
  heldCapabilitiesText,
  NO_ROLES,
  ROLES_LABEL,
  roleUnavailable,
  splitAssigned,
} from '#/pages/clients/services/serviceRoles';
import { canChange, type ServiceAccountReach } from '#/pages/clients/services/ceiling';
import { ceilingRefused } from '#/pages/clients/services/refusal';
import { SERVICE_SECTION } from '#/pages/clients/services/tabs';
import type { RecordState } from '#/shared/repository/useRecord';
import { assignedRoles, knownAssignments, roleNameOf, useRolePicker } from '#/entities/role';
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
): ServiceAccess & { idle: string | null; capability: AdminCapability } {
  return {
    ...serviceAccess(client, useAuthority(tenant)),
    idle: accountIdleNote(client),
    capability: SERVICE_CAPABILITY,
  };
}

export function useServiceRolesRead(
  tenant: string,
  subjectId: string,
): RecordState<SetRolesResponse> {
  return useServiceRolesRecord(tenant, subjectId);
}

// An assigned role as the list shows it.
export interface AssignedRow {
  id: string;
  name: string;
  owner: string;
}

export interface ServiceRoles {
  rule: string;
  noRoles: string;
  // How many roles are assigned.
  assignedLine: string;
  // Whether the roles can be changed: the ceiling on the account is judged
  // and holds nothing back.
  offered: boolean;
  needs: readonly AdminCapability[];
  accountHref: string;
  save: SectionSave<RoleValues>;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  assigned: readonly AssignedRow[];
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
  reach: ServiceAccountReach;
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
    label: ROLES_LABEL,
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
        label: ROLES_LABEL,
        kind: 'plain',
        describe: (value) => describeIds(value, roleNameOf(known)),
      },
    },
    save: (gateway, { values, ifMatch }) =>
      saveRoles(gateway, [...values.role_ids, ...split.adminIds], ifMatch),
  });
  const assigned = assignedRoles(save.values.role_ids, known);
  return {
    rule: SERVICE_RULE,
    noRoles: NO_ROLES,
    assignedLine: assignedCount(assigned.length),
    offered: canChange(reach, needs),
    needs,
    accountHref: subjectHref(tenant, subjectId),
    save,
    picker,
    unavailableOf: (role) => roleUnavailable(role, caller),
    choose: (ids) => {
      save.edit('role_ids', sortedIds(ids));
    },
    assigned: assigned.map((role) => ({
      id: role.id,
      name: role.name,
      owner: roleOwnerLine(role.client),
    })),
    kept: heldCapabilitiesText(data.items),
  };
}
