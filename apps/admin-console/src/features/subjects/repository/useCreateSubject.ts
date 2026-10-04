import type { Subject } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFreshRead } from '#/shared/repository/useFreshRead.ts';
import { createSubject } from '#/features/subjects/adapter/subjects.ts';
import { findSubject } from '#/shared/adapter/administrators.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface CreateSubject {
  busy: boolean;
  create: (input: { username: string; email: string }) => Promise<GatewayResult<Subject>>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (username: string) => Promise<GatewayResult<Subject | null>>;
}

export function useCreateSubject(tenant: string): CreateSubject {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const created = (result: GatewayResult<unknown>): void => {
    if (result.ok) {
      client.invalidateQueries({ queryKey: ['list', tenant, 'subjects'] }).catch(() => undefined);
    }
  };
  const create = useMutation({
    mutationFn: (input: { username: string; email: string }) =>
      createSubject(gateway, tenant, input),
    onSuccess: created,
  });
  const fresh = useFreshRead();
  return {
    busy: create.isPending || fresh.pending,
    create: (input) => create.mutateAsync(input),
    find: (username) =>
      fresh.read(['find', tenant, 'subjects', username], () =>
        findSubject(gateway, tenant, username),
      ),
  };
}
