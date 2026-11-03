import type { Group } from '#/entities/group';
import { createGroup, findGroup } from '#/pages/groups/adapter/groups';
import { findKey, listKey, pickerKey } from '#/shared/repository/queryKeys';
import { useFreshRead } from '#/shared/repository/useFreshRead';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useWrite } from '#/shared/repository/useWrite';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

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
  const { invalidate } = useInvalidate();
  const create = useWrite({
    send: (gateway, input: GroupInput) => createGroup(gateway, tenant, input),
    onSuccess: (result) => {
      if (!result.ok) return;
      invalidate(listKey(tenant, 'groups'), pickerKey(tenant, 'groups'));
    },
  });
  const fresh = useFreshRead();
  return {
    busy: create.busy || fresh.pending,
    create: create.run,
    find: (name, parentId) =>
      fresh.read(findKey(tenant, 'groups', parentId ?? 'root', name), () =>
        findGroup(gateway, tenant, name, parentId),
      ),
  };
}
