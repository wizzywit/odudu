import type { Group, SetGroupRolesResponse } from '@odudu/contracts/admin';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  amendGroup,
  deleteGroup,
  readGroup,
  readGroupRoles,
  readGroupTrail,
  setGroupDefault,
  setGroupRoles,
  type TrailStep,
} from '#/features/groups/adapter/groups.ts';
import { groupRecord, groupRolesRecord } from '#/features/groups/service.ts';
import { useRecord, type RecordState } from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function useGroupRecord(tenant: string, id: string): RecordState<Group> {
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

// A group known by its id alone, such as the parent a creation was asked
// from; nothing is read for none.
export function useGroupNamed(tenant: string, id: string | null): Group | undefined {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: ['group', tenant, id],
    enabled: id !== null,
    queryFn: () => (id === null ? Promise.resolve(null) : readGroup(gateway, tenant, id)),
  });
  return query.data?.ok === true ? query.data.data : undefined;
}

export type TrailRead =
  | { status: 'loading' }
  | { status: 'ready'; steps: readonly TrailStep[] }
  | { status: 'failed'; retry: () => void };

function trailKey(tenant: string, id: string) {
  return ['group-trail', tenant, id] as const;
}

// The group and every group above it, with their roles: what its members
// receive through it, which every ceiling on its writes is judged by.
export function useGroupTrail(tenant: string, id: string): TrailRead {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: trailKey(tenant, id),
    queryFn: () => readGroupTrail(gateway, tenant, id),
  });
  const result = query.data;
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', steps: result.data };
  return {
    status: 'failed',
    retry: () => {
      client
        .invalidateQueries({ queryKey: trailKey(tenant, id), exact: true })
        .catch(() => undefined);
    },
  };
}

// A group's place or roles change what every group beneath it hands out,
// what its members hold, and what the lists show.
function useAfterGroupChange(tenant: string) {
  const client = useQueryClient();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) {
      for (const key of [
        ['group-trail', tenant],
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
    // An emptied description is cleared, as the server keeps no empty one.
    description: async (gateway: Gateway, { values, ifMatch }: SaveInput<DescriptionValues>) =>
      after(
        await amendGroup(
          gateway,
          tenant,
          id,
          { description: values.description === '' ? null : values.description },
          ifMatch,
        ),
      ),
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
  const after = useAfterGroupChange(tenant);
  // The record's own entries are left to lapse: removing them while its page
  // is still mounted would read them again, and find nothing.
  const mutation = useMutation({
    mutationFn: async () => after(await deleteGroup(gateway, tenant, id)),
  });
  return { busy: mutation.isPending, run: () => mutation.mutateAsync() };
}
