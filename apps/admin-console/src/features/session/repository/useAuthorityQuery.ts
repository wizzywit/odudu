import { useQuery } from '@tanstack/react-query';
import { readAuthority } from '#/features/session/adapter/session';
import { type Authority } from '#/shared/services/principal';
import { authorityOf, refusedUnknownOf } from '#/features/session/services/whoami';
import { authorityKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useTransport } from '#/shared/transport/useTransport';

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
  const { invalidate } = useInvalidate();
  const key = authorityKey(tenant, subjectId);
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
    authority: authorityOf(query.data),
    refusedUnknown: refusedUnknownOf(query.data),
    answered: query.data !== undefined,
    reread: () => {
      invalidate(key);
    },
  };
}
