import type { Group } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createGroup, findGroup } from '#/features/groups/adapter/groups.ts';
import { useFreshRead } from '#/shared/repository/useFreshRead.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface GroupInput {
  name: string;
  description: string;
  parentId: string | null;
}

export interface CreateGroup {
  busy: boolean;
  create: (input: GroupInput) => Promise<GatewayResult<Group>>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (name: string, parentId: string | null) => Promise<GatewayResult<Group | null>>;
}

export function useCreateGroup(tenant: string): CreateGroup {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: (input: GroupInput) => createGroup(gateway, tenant, input),
    onSuccess: (result) => {
      if (!result.ok) return;
      client.invalidateQueries({ queryKey: ['list', tenant, 'groups'] }).catch(() => undefined);
      client.invalidateQueries({ queryKey: ['picker', tenant, 'groups'] }).catch(() => undefined);
    },
  });
  const fresh = useFreshRead();
  return {
    busy: create.isPending || fresh.pending,
    create: (input) => create.mutateAsync(input),
    find: (name, parentId) =>
      fresh.read(['find', tenant, 'groups', parentId ?? 'root', name], () =>
        findGroup(gateway, tenant, name, parentId),
      ),
  };
}
