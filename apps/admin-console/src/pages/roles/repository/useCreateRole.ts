import type { Role } from '#/entities/role';
import { useQuery } from '@tanstack/react-query';
import {
  addComposite,
  createRole,
  findRole,
  readComposites,
  readRole,
} from '#/pages/roles/adapter/roles';
import { copySourceOf, type CopyRead } from '#/pages/roles/services/roleCopy';
import { copyReadOf } from '#/shared/lib/services/copy';
import { copyKey, findKey, listKey, pickerKey } from '#/shared/lib/repository/queryKeys';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useWrite } from '#/shared/lib/repository/useWrite';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

export interface RoleInput {
  name: string;
  description: string;
}

export interface CreateRole {
  busy: boolean;
  create: (input: RoleInput) => Promise<GatewayResult<Role>>;
  // Nests each child under the new role in turn, answering those that failed.
  nest: (id: string, children: readonly Role[]) => Promise<Role[]>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (name: string) => Promise<GatewayResult<Role | null>>;
}

export function useCreateRole(tenant: string): CreateRole {
  const { gateway } = useTransport();
  const { invalidate } = useInvalidate();
  const create = useWrite({
    send: (gateway, input: RoleInput) => createRole(gateway, tenant, input),
    onSuccess: (result) => {
      if (!result.ok) return;
      invalidate(listKey(tenant, 'roles'), pickerKey(tenant, 'roles'));
    },
  });
  const nest = useWrite({
    send: async (gateway, { id, children }: { id: string; children: readonly Role[] }) => {
      const failed: Role[] = [];
      for (const child of children) {
        const added = await addComposite(gateway, tenant, id, child.id, null);
        if (!added.ok) failed.push(child);
      }
      return failed;
    },
  });
  const fresh = useFreshRead();
  return {
    busy: create.busy || nest.busy || fresh.pending,
    create: create.run,
    nest: (id, children) => nest.run({ id, children }),
    find: (name) =>
      fresh.read(findKey(tenant, 'roles', name), () => findRole(gateway, tenant, name)),
  };
}

export type { CopyRead };

// The role a copy is made of, and what it nests.
export function useCopySource(tenant: string, id: string | null): CopyRead {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: copyKey(tenant, id),
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) return null;
      const [role, children] = await Promise.all([
        readRole(gateway, tenant, id),
        readComposites(gateway, tenant, id),
      ]);
      return copySourceOf(role, children);
    },
  });
  return copyReadOf(id, query.data, query.isError);
}
