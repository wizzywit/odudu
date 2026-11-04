import type { PasskeyImpactResponse } from '#/pages/domains/types/domain';
import { readPasskeyImpact } from '#/pages/domains/adapter/domains';
import { passkeyImpactKey } from '#/pages/domains/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

// Read only while a switch to `target` is asked for; null reads nothing.
export function usePasskeyImpact(
  tenant: string,
  target: string | null,
): Read<PasskeyImpactResponse> {
  const { gateway } = useTransport();
  return useRead(passkeyImpactKey(tenant, target ?? ''), target !== null, () =>
    readPasskeyImpact(gateway, tenant, target ?? ''),
  );
}
