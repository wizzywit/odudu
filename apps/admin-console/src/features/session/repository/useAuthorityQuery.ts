import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readAuthority } from '#/features/session/adapter/session.ts';
import type { Authority } from '#/features/session/service.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// The admin API answers a tenant it does not know with a plain 401, and the
// gateway passes that through with the session kept; a 401 that ended the
// session carries the gateway's own problem type instead.
function refusedUnknown(result: GatewayResult<Authority> | undefined): boolean {
  return (
    result?.ok === false &&
    result.kind === 'problem' &&
    result.problem.status === 401 &&
    result.problem.type === 'about:blank'
  );
}

// Keyed by the principal as well as the tenant, so what whoami told one
// administrator is never offered to another signed in after them.
export function useAuthorityQuery(
  tenant: string,
  subjectId: string | null,
): {
  readonly authority: Authority | undefined;
  // undefined until whoami has answered.
  readonly refusedUnknown: boolean | undefined;
  readonly reread: () => void;
} {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = ['whoami', tenant, subjectId] as const;
  // Every page and the rail ask for it, so a page mounting must not read it
  // again each time: a 403 re-reads it, and so does coming back to the window.
  // With no principal, as once a session has ended, there is nobody to ask about.
  const query = useQuery({
    queryKey: key,
    queryFn: () => readAuthority(gateway, tenant),
    refetchOnMount: false,
    enabled: subjectId !== null,
  });
  return {
    authority: query.data?.ok === true ? query.data.data : undefined,
    refusedUnknown: query.data === undefined ? undefined : refusedUnknown(query.data),
    reread: () => {
      client.invalidateQueries({ queryKey: key }).catch(() => undefined);
    },
  };
}
