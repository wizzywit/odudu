import type { Role } from '@odudu/contracts/admin';
import { createClientRole } from '#/pages/clients/adapter/clients';
import { readRoleCount, readRolePage } from '#/shared/adapter/directory';
import { countKey, listKey, pickerKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useWrite } from '#/shared/repository/useWrite';

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
  const { invalidate } = useInvalidate();
  const mutation = useWrite({
    send: (gateway, input: { name: string; description: string }) =>
      createClientRole(gateway, tenant, clientDbId, input),
    onSuccess: (result) => {
      if (!result.ok) return;
      const own = `clients/${clientDbId}/roles`;
      invalidate(
        listKey(tenant, own),
        countKey(tenant, own),
        listKey(tenant, 'roles'),
        pickerKey(tenant, 'roles'),
      );
    },
  });
  return { busy: mutation.busy, create: mutation.run };
}
