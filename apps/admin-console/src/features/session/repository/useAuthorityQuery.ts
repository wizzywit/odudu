import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readAuthority } from '#/features/session/adapter/session.ts';
import type { Authority } from '#/features/session/service.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function useAuthorityQuery(tenant: string): {
  readonly authority: Authority | undefined;
  readonly reread: () => void;
} {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = ['whoami', tenant] as const;
  const query = useQuery({ queryKey: key, queryFn: () => readAuthority(gateway, tenant) });
  return {
    authority: query.data?.ok === true ? query.data.data : undefined,
    reread: () => {
      client.invalidateQueries({ queryKey: key }).catch(() => undefined);
    },
  };
}
