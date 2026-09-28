import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readAuthority } from '#/features/session/adapter/session.ts';
import type { Authority } from '#/features/session/service.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Keyed by the principal as well as the tenant, so what whoami told one
// administrator is never offered to another signed in after them.
export function useAuthorityQuery(
  tenant: string,
  subjectId: string | null,
): {
  readonly authority: Authority | undefined;
  readonly reread: () => void;
} {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = ['whoami', tenant, subjectId] as const;
  const query = useQuery({ queryKey: key, queryFn: () => readAuthority(gateway, tenant) });
  return {
    authority: query.data?.ok === true ? query.data.data : undefined,
    reread: () => {
      client.invalidateQueries({ queryKey: key }).catch(() => undefined);
    },
  };
}
