import type { Role } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClientRole } from '#/features/clients/adapter/clients.ts';
import { readRoleCount, readRolePage } from '#/shared/adapter/directory.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// The roles the client owns, a page at a time and counted, whatever the tenant holds.
export function useClientRoleList(tenant: string, clientDbId: string): ResourceListState<Role> {
  return useResourceList({
    tenant,
    resource: `clients/${clientDbId}/roles`,
    search: ['name'],
    fixed: { client: clientDbId },
    read: (gateway, query) => readRolePage(gateway, tenant, query),
    count: (gateway, query) => readRoleCount(gateway, tenant, query),
  });
}

export interface CreateClientRole {
  busy: boolean;
  create: (input: { name: string; description: string }) => Promise<GatewayResult<Role>>;
}

export function useCreateClientRole(tenant: string, clientDbId: string): CreateClientRole {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { name: string; description: string }) =>
      createClientRole(gateway, tenant, clientDbId, input),
    onSuccess: (result) => {
      if (!result.ok) return;
      for (const key of [
        ['list', tenant, `clients/${clientDbId}/roles`],
        ['count', tenant, `clients/${clientDbId}/roles`],
        ['list', tenant, 'roles'],
        ['picker', tenant, 'roles'],
      ]) {
        client.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
    },
  });
  return { busy: mutation.isPending, create: (input) => mutation.mutateAsync(input) };
}
