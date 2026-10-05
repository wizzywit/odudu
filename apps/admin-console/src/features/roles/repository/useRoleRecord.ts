import type { ListRoleCompositesResponse, Role } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addComposite,
  amendRole,
  deleteRole,
  readComposites,
  readRole,
  removeComposite,
  setRoleDefault,
} from '#/features/roles/adapter/roles.ts';
import { compositesRecord, roleRecord } from '#/features/roles/service.ts';
import { isStale } from '#/shared/service/failure.ts';
import { recordKey, useRecord, type RecordState } from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function useRoleRecord(tenant: string, id: string): RecordState<Role> {
  return useRecord({
    tenant,
    record: roleRecord(id),
    read: (gateway) => readRole(gateway, tenant, id),
  });
}

export function useCompositesRecord(
  tenant: string,
  id: string,
): RecordState<ListRoleCompositesResponse> {
  return useRecord({
    tenant,
    record: compositesRecord(id),
    read: (gateway) => readComposites(gateway, tenant, id),
  });
}

// What a role nests changes what its holders hold, what every role and group
// above it reaches, and what the lists show; a deleted role's own reads are
// left to lapse, since reading them again would only find it gone.
function useAfterRoleChange(tenant: string, deleted: string | null = null) {
  const client = useQueryClient();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) {
      const gone = deleted === null ? null : roleRecord(deleted);
      client
        .invalidateQueries({
          predicate: ({ queryKey: [kind, at, which] }) =>
            at === tenant &&
            (((kind === 'role' || kind === 'group') && which !== deleted) ||
              (kind === 'record' &&
                typeof which === 'string' &&
                (which.startsWith('roles/') || which.startsWith('groups/')) &&
                (gone === null || !which.startsWith(gone)))),
        })
        .catch(() => undefined);
      for (const key of [
        ['list', tenant],
        ['picker', tenant, 'roles'],
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

export interface DefaultValues extends Readonly<Record<string, unknown>> {
  default_for_new_subjects: boolean;
}

export function useRoleSaves(tenant: string, id: string) {
  const after = useAfterRoleChange(tenant);
  return {
    description: async (gateway: Gateway, { values, ifMatch }: SaveInput<DescriptionValues>) =>
      after(await amendRole(gateway, tenant, id, { description: values.description }, ifMatch)),
    default: async (gateway: Gateway, { values, ifMatch }: SaveInput<DefaultValues>) =>
      after(await setRoleDefault(gateway, tenant, id, values.default_for_new_subjects, ifMatch)),
  };
}

export interface Edge {
  child: string;
  ifMatch: string;
}

export interface CompositeRemoval {
  busy: boolean;
  remove: (edge: Edge) => Promise<GatewayResult<undefined>>;
}

// One edge at a time, on the ETag the list was read with; the list is read
// again afterwards, since the write does not answer it.
export function useCompositeRemoval(tenant: string, id: string): CompositeRemoval {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const after = useAfterRoleChange(tenant);
  const reread = <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok || isStale(result)) {
      client
        .invalidateQueries({ queryKey: recordKey(tenant, compositesRecord(id)), exact: true })
        .catch(() => undefined);
    }
    return after(result);
  };
  const remove = useMutation({
    mutationFn: async ({ child, ifMatch }: Edge) =>
      reread(await removeComposite(gateway, tenant, id, child, ifMatch)),
  });
  return { busy: remove.isPending, remove: (edge) => remove.mutateAsync(edge) };
}

export interface RoleDeletion {
  busy: boolean;
  run: () => Promise<GatewayResult<undefined>>;
}

export function useRoleDeletion(tenant: string, id: string): RoleDeletion {
  const { gateway } = useTransport();
  const after = useAfterRoleChange(tenant, id);
  // The record's own entries are left to lapse: removing them while its page
  // is still mounted would read them again, and find nothing.
  const mutation = useMutation({
    mutationFn: async () => after(await deleteRole(gateway, tenant, id)),
  });
  return { busy: mutation.isPending, run: () => mutation.mutateAsync() };
}

export interface AddValues extends Readonly<Record<string, unknown>> {
  child_role_id: string | null;
}

// Nests one role, then answers the list as its read does, so the section's
// record is the list it was saved against.
export function useAddComposite(tenant: string, id: string) {
  const after = useAfterRoleChange(tenant);
  return async (
    gateway: Gateway,
    { values, ifMatch }: SaveInput<AddValues>,
  ): Promise<GatewayResult<ListRoleCompositesResponse>> => {
    if (values.child_role_id === null) return { ok: false, kind: 'defect' };
    const added = after(await addComposite(gateway, tenant, id, values.child_role_id, ifMatch));
    if (!added.ok) return added;
    return readComposites(gateway, tenant, id);
  };
}
