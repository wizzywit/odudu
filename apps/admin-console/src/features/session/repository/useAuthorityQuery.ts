import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readAuthority } from '#/features/session/adapter/session.ts';
import type { Authority } from '#/features/session/service';
import { isUnknownTenant } from '#/shared/service/failure.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Keyed by the principal as well as the tenant, so what whoami told one
// administrator is never offered to another signed in after them.
export function useAuthorityQuery(
  tenant: string,
  subjectId: string | null,
  // False once the session has ended: what whoami said is kept, and it is
  // not asked again until the principal signs back in.
  live = true,
): {
  authority: Authority | undefined;
  // undefined until whoami has answered.
  refusedUnknown: boolean | undefined;
  // Whether whoami has answered at all, with its capabilities or a failure.
  answered: boolean;
  reread: () => void;
} {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = ['whoami', tenant, subjectId] as const;
  // Every page and the rail ask for it, so it is fresh for half a minute:
  // one read per page, and a capability gained mid-session shows on the next
  // page after that. A 403 re-reads it at once.
  const query = useQuery({
    queryKey: key,
    queryFn: () => readAuthority(gateway, tenant),
    staleTime: 30_000,
    enabled: subjectId !== null && live,
  });
  return {
    authority: query.data?.ok === true ? query.data.data : undefined,
    refusedUnknown: query.data === undefined ? undefined : isUnknownTenant(query.data),
    answered: query.data !== undefined,
    reread: () => {
      client.invalidateQueries({ queryKey: key }).catch(() => undefined);
    },
  };
}
