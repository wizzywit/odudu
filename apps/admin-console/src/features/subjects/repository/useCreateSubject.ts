import type { Subject } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSubject } from '#/features/subjects/adapter/subjects.ts';
import { findSubject } from '#/shared/adapter/administrators.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface CreateSubject {
  readonly busy: boolean;
  readonly create: (input: {
    readonly username: string;
    readonly email: string;
  }) => Promise<GatewayResult<Subject>>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  readonly find: (username: string) => Promise<GatewayResult<Subject | null>>;
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
    mutationFn: (input: { readonly username: string; readonly email: string }) =>
      createSubject(gateway, tenant, input),
    onSuccess: created,
  });
  const find = useMutation({
    mutationFn: (username: string) => findSubject(gateway, tenant, username),
  });
  return {
    busy: create.isPending || find.isPending,
    create: (input) => create.mutateAsync(input),
    find: (username) => find.mutateAsync(username),
  };
}
