import { useQuery } from '@tanstack/react-query';
import type { PasskeyImpactResponse } from '#/pages/domains/types/domain';
import { readPasskeyImpact } from '#/pages/domains/adapter/domains';
import { passkeyImpactKey } from '#/pages/domains/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { impactRead } from '#/pages/domains/services/passkeyWarning';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

// Read only while a switch to `target` is asked for; null reads nothing. The
// count is read afresh every time and an answer kept from an earlier ask is
// not offered while it is read: a stale count of none must not open the switch.
export function usePasskeyImpact(
  tenant: string,
  target: string | null,
): Read<PasskeyImpactResponse> {
  const { gateway } = useTransport();
  const { invalidateExact } = useInvalidate();
  const key = passkeyImpactKey(tenant, target ?? '');
  const query = useQuery({
    queryKey: key,
    enabled: target !== null,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => readPasskeyImpact(gateway, tenant, target ?? ''),
  });
  return impactRead(query.isFetching, query.data, () => {
    invalidateExact(key);
  });
}
