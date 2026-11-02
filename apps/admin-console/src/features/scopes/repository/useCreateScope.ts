import type { ClientScope } from '@odudu/contracts/admin';
import { useQuery } from '@tanstack/react-query';
import {
  createScope,
  findScope,
  readScope,
  readScopeMappers,
  readScopeRoles,
  setScopeMappers,
  setScopeRoles,
  type CreateScopeInput,
} from '#/features/scopes/adapter/scopes';
import {
  asksPart,
  copySourceOf,
  partMissed,
  type CopyPart as Part,
  type CopyRead,
} from '#/features/scopes/services/copy';
import { copyReadOf } from '#/shared/services/copy';
import {
  copyEtagKey,
  copyKey,
  countKey,
  findKey,
  listKey,
  pickerKey,
} from '#/shared/repository/queryKeys';
import { useFreshRead } from '#/shared/repository/useFreshRead';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useWrite } from '#/shared/repository/useWrite';
import { etagOfRead } from '#/shared/services/record';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

export type ScopeInput = CreateScopeInput;

export interface CreateScope {
  busy: boolean;
  create: (input: ScopeInput) => Promise<GatewayResult<ClientScope>>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (name: string) => Promise<GatewayResult<ClientScope | null>>;
  // Maps the roles and binds the mappers of a copy, one write each on the tag
  // its own read answers, and answers the parts that did not take.
  fill: (id: string, roleIds: readonly string[], mapperNames: readonly string[]) => Promise<Part[]>;
}

export function useCreateScope(tenant: string): CreateScope {
  const { gateway } = useTransport();
  const { invalidate } = useInvalidate();
  const create = useWrite({
    send: (gateway, input: ScopeInput) => createScope(gateway, tenant, input),
    onSuccess: (result) => {
      if (!result.ok) return;
      invalidate(
        listKey(tenant, 'scopes'),
        countKey(tenant, 'scopes'),
        pickerKey(tenant, 'scopes'),
      );
    },
  });
  const setRoles = useWrite({
    send: (
      gateway,
      { id, ids, ifMatch }: { id: string; ids: readonly string[]; ifMatch: string },
    ) => setScopeRoles(gateway, tenant, id, ids, ifMatch),
  });
  const setMappers = useWrite({
    send: (
      gateway,
      { id, names, ifMatch }: { id: string; names: readonly string[]; ifMatch: string },
    ) => setScopeMappers(gateway, tenant, id, names, ifMatch),
  });
  const fresh = useFreshRead();
  // Reads the part for its tag, then writes on it; a read that gave none
  // is the failure.
  const mapPart = async (
    part: Part,
    id: string,
    wanted: readonly string[],
    read: () => Promise<GatewayResult<unknown>>,
    write: (ifMatch: string) => Promise<GatewayResult<unknown>>,
  ): Promise<Part[]> => {
    if (!asksPart(wanted)) return [];
    const answer = await fresh.read(copyEtagKey(tenant, id, part), read);
    const ifMatch = etagOfRead(answer);
    return partMissed(part, ifMatch === null ? null : await write(ifMatch));
  };
  return {
    busy: create.busy || setRoles.busy || setMappers.busy || fresh.pending,
    fill: async (id, roleIds, mapperNames) => [
      ...(await mapPart(
        'roles',
        id,
        roleIds,
        () => readScopeRoles(gateway, tenant, id),
        (ifMatch) => setRoles.run({ id, ids: roleIds, ifMatch }),
      )),
      ...(await mapPart(
        'mappers',
        id,
        mapperNames,
        () => readScopeMappers(gateway, tenant, id),
        (ifMatch) => setMappers.run({ id, names: mapperNames, ifMatch }),
      )),
    ],
    create: create.run,
    // The search is a prefix, so an exact match is picked out of its answer.
    find: (name) =>
      fresh.read(findKey(tenant, 'scopes', name), () => findScope(gateway, tenant, name)),
  };
}

// The scope a copy is made of, with the roles it maps and the mappers it binds.
export function useCopySource(tenant: string, id: string | null): CopyRead {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: copyKey(tenant, 'scopes', id),
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) return null;
      const [scope, roles, mappers] = await Promise.all([
        readScope(gateway, tenant, id),
        readScopeRoles(gateway, tenant, id),
        readScopeMappers(gateway, tenant, id),
      ]);
      return copySourceOf(scope, roles, mappers);
    },
  });
  return copyReadOf(id, query.data, query.isError);
}
