import type { Installation } from '#/pages/clients/types/installation';
import { readInstallation } from '#/pages/clients/adapter/operations';
import { installationKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

export function useClientInstallation(tenant: string, clientDbId: string): Read<Installation> {
  const { gateway } = useTransport();
  return useRead(installationKey(tenant, clientDbId), true, () =>
    readInstallation(gateway, tenant, clientDbId),
  );
}
