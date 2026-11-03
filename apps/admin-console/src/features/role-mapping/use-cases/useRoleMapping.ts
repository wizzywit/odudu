import { useRefusal } from '#/entities/session';
import {
  keptMapped,
  mappedRoles,
  roleIndex,
  roleNameOf,
  useRolePicker,
  withKept,
  type MappedRole,
  type ReachFrom,
  type Role,
  type RoleValues,
} from '#/entities/role';
import {
  useSectionSave,
  type SaveInput,
  type SectionSave,
} from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { describeIds } from '#/shared/lib/services/format';
import { sortedIds } from '#/shared/lib/services/ids';
import type { PickerState } from '#/shared/lib/services/picker';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

export interface MappedItem {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  admin_reach: readonly string[];
}

export interface RoleMappingModel {
  save: SectionSave<RoleValues>;
  // Whether the picker is offered: what the ceiling needs has been read.
  offered: boolean;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  mapped: readonly MappedRole[];
  // Mapped roles this caller may not take away, each kept by every save.
  kept: readonly string[];
}

// The roles a group or a scope hands on: one `role_ids` field, saved as a
// whole, and every role the caller could not give kept through each save.
export function useRoleMapping<R>({
  tenant,
  record,
  etag,
  gone,
  items,
  caller,
  offered,
  unavailableOf,
  reachFrom,
  saveRoles,
}: {
  tenant: string;
  record: string;
  etag: string;
  gone: boolean;
  items: readonly MappedItem[];
  caller: readonly AdminCapability[];
  offered: boolean;
  unavailableOf: (role: Role) => string | null;
  reachFrom: ReachFrom;
  saveRoles: (gateway: Gateway, input: SaveInput<RoleValues>) => Promise<GatewayResult<R>>;
}): RoleMappingModel {
  const refusal = useRefusal(tenant);
  const picker = useRolePicker(tenant);
  const known = roleIndex(items, picker.options);
  const kept = keptMapped(items, caller, tenant, known, reachFrom);
  const save = useSectionSave({
    tenant,
    record,
    section: 'roles',
    label: 'Roles',
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      role_ids: {
        value: sortedIds(items.map((role) => role.id)),
        label: 'Roles',
        kind: 'plain',
        describe: (value) => describeIds(value, roleNameOf(known)),
      },
    },
    save: saveRoles,
  });
  return {
    save,
    offered,
    picker,
    unavailableOf,
    choose: (ids) => {
      save.edit('role_ids', withKept(ids, kept));
    },
    mapped: mappedRoles(save.values.role_ids, known),
    kept,
  };
}
