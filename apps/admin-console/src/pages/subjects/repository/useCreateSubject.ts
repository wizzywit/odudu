import { findKey, listKey } from '#/shared/lib/repository/queryKeys';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useWrite } from '#/shared/lib/repository/useWrite';
import { useTransport } from '#/shared/api/transport/useTransport';
import { createSubject, findSubject, type Subject } from '#/entities/subject';

export interface CreateSubject {
  busy: boolean;
  create: (input: { username: string; email: string }) => Promise<GatewayResult<Subject>>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (username: string) => Promise<GatewayResult<Subject | null>>;
}

export function useCreateSubject(tenant: string): CreateSubject {
  const { gateway } = useTransport();
  const { invalidate } = useInvalidate();
  const created = (result: GatewayResult<unknown>): void => {
    if (result.ok) invalidate(listKey(tenant, 'subjects'));
  };
  const create = useWrite({
    send: (gateway, input: { username: string; email: string }) =>
      createSubject(gateway, tenant, input),
    onSuccess: created,
  });
  const fresh = useFreshRead();
  return {
    busy: create.busy || fresh.pending,
    create: create.run,
    find: (username) =>
      fresh.read(findKey(tenant, 'subjects', username), () =>
        findSubject(gateway, tenant, username),
      ),
  };
}
