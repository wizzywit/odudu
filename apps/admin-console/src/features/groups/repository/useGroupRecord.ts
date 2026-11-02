import type { GroupRecord, SetGroupRolesResponse } from '@odudu/contracts/admin';
import {
  amendGroup,
  deleteGroup,
  readGroup,
  readGroupRoles,
  setGroupDefault,
  setGroupRoles,
} from '#/features/groups/adapter/groups';
import { namedGroupRead, type GroupRead } from '#/features/groups/services/ceiling';
import { groupRecord, groupRolesRecord } from '#/features/groups/services/tabs';
import {
  GROUP_KIND,
  groupKey,
  heldCapabilitiesKey,
  holdersKey,
  listKey,
  pickerKey,
} from '#/shared/repository/queryKeys';
import { useAfterChange } from '#/shared/repository/useAfterChange';
import { useRead } from '#/shared/repository/useRead';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';
import { useWrite, type Write } from '#/shared/repository/useWrite';
import type { DescriptionValues, DefaultValues, RoleValues } from '#/shared/services/sectionValues';

export function useGroupRecord(tenant: string, id: string): RecordState<GroupRecord> {
  return useRecord({
    tenant,
    record: groupRecord(id),
    read: (gateway) => readGroup(gateway, tenant, id),
  });
}

export function useGroupRolesRecord(
  tenant: string,
  id: string,
): RecordState<SetGroupRolesResponse> {
  return useRecord({
    tenant,
    record: groupRolesRecord(id),
    read: (gateway) => readGroupRoles(gateway, tenant, id),
  });
}

export type { GroupRead };

// What a read of no group answers if it is ever run, which a disabled read is not.
const UNASKED: GatewayResult<GroupRecord> = { ok: false, kind: 'defect' };

// A group known by its id alone, such as a record's parent or the parent a
// creation was asked from; nothing is read for none.
export function useGroupNamed(tenant: string, id: string | null): GroupRead {
  const { gateway } = useTransport();
  const read = useRead(groupKey(tenant, id), id !== null, () =>
    id === null ? Promise.resolve(UNASKED) : readGroup(gateway, tenant, id),
  );
  return namedGroupRead(id, read);
}

// What a group hands out follows from its roles and its place, so every
// group read is read again but a deleted one's, which would only find it gone.
function useAfterGroupChange(tenant: string, deleted: string | null = null) {
  return useAfterChange(tenant, deleted, {
    kinds: [GROUP_KIND],
    records: ['groups/'],
    recordOf: groupRecord,
    keys: [
      listKey(tenant),
      pickerKey(tenant, 'groups'),
      heldCapabilitiesKey(tenant),
      holdersKey(tenant),
    ],
  });
}

export interface ParentValues extends Readonly<Record<string, unknown>> {
  parent_id: string | null;
}

export function useGroupSaves(tenant: string, id: string) {
  const after = useAfterGroupChange(tenant);
  return {
    description: async (gateway: Gateway, { values, ifMatch }: SaveInput<DescriptionValues>) =>
      after(await amendGroup(gateway, tenant, id, { description: values.description }, ifMatch)),
    parent: async (gateway: Gateway, { values, ifMatch }: SaveInput<ParentValues>) =>
      after(await amendGroup(gateway, tenant, id, { parent_id: values.parent_id }, ifMatch)),
    default: async (gateway: Gateway, { values, ifMatch }: SaveInput<DefaultValues>) =>
      after(await setGroupDefault(gateway, tenant, id, values.default_for_new_subjects, ifMatch)),
    roles: async (gateway: Gateway, { values, ifMatch }: SaveInput<RoleValues>) =>
      after(await setGroupRoles(gateway, tenant, id, [...new Set(values.role_ids)], ifMatch)),
  };
}

export function useGroupDeletion(
  tenant: string,
  id: string,
): Write<void, GatewayResult<undefined>> {
  const after = useAfterGroupChange(tenant, id);
  // The record's own entries are left to lapse: removing them while its page
  // is still mounted would read them again, and find nothing.
  return useWrite({
    send: async (gateway) => after(await deleteGroup(gateway, tenant, id)),
  });
}
