import type { GroupRecord, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  amendGroup,
  deleteGroup,
  readGroup,
  readGroupRoles,
  setGroupDefault,
  setGroupRoles,
} from '#/features/groups/adapter/groups.ts';
import { groupRecord, groupRolesRecord, type GroupRead } from '#/features/groups/service';
import { useRecord, type RecordState } from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

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

function groupKey(tenant: string, id: string | null) {
  return ['group', tenant, id] as const;
}

// A group known by its id alone, such as a record's parent or the parent a
// creation was asked from; nothing is read for none.
export function useGroupNamed(tenant: string, id: string | null): GroupRead {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: groupKey(tenant, id),
    enabled: id !== null,
    queryFn: () => (id === null ? Promise.resolve(null) : readGroup(gateway, tenant, id)),
  });
  if (id === null) return { status: 'none' };
  const result = query.data;
  if (result === undefined || result === null) return { status: 'loading' };
  if (result.ok) return { status: 'ready', group: result.data };
  return {
    status: 'failed',
    retry: () => {
      client
        .invalidateQueries({ queryKey: groupKey(tenant, id), exact: true })
        .catch(() => undefined);
    },
  };
}

// What a group hands out follows from its roles and its place, so every
// group read is read again but a deleted one's, which would only find it gone.
function useAfterGroupChange(tenant: string, deleted: string | null = null) {
  const client = useQueryClient();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) {
      const gone = deleted === null ? null : groupRecord(deleted);
      client
        .invalidateQueries({
          predicate: ({ queryKey: [kind, at, which] }) =>
            at === tenant &&
            ((kind === 'group' && which !== deleted) ||
              (kind === 'record' &&
                typeof which === 'string' &&
                which.startsWith('groups/') &&
                (gone === null || !which.startsWith(gone)))),
        })
        .catch(() => undefined);
      for (const key of [
        ['list', tenant],
        ['picker', tenant, 'groups'],
        ['effective-roles', tenant],
        ['holders', tenant],
      ]) {
        client.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
    }
    return result;
  };
}

export interface DescriptionValues extends Readonly<Record<string, unknown>> {
  description: string;
}

export interface ParentValues extends Readonly<Record<string, unknown>> {
  parent_id: string | null;
}

export interface DefaultValues extends Readonly<Record<string, unknown>> {
  default_for_new_subjects: boolean;
}

export interface RoleValues extends Readonly<Record<string, unknown>> {
  role_ids: readonly string[];
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

export interface GroupDeletion {
  busy: boolean;
  run: () => Promise<GatewayResult<undefined>>;
}

export function useGroupDeletion(tenant: string, id: string): GroupDeletion {
  const { gateway } = useTransport();
  const after = useAfterGroupChange(tenant, id);
  // The record's own entries are left to lapse: removing them while its page
  // is still mounted would read them again, and find nothing.
  const mutation = useMutation({
    mutationFn: async () => after(await deleteGroup(gateway, tenant, id)),
  });
  return { busy: mutation.isPending, run: () => mutation.mutateAsync() };
}
