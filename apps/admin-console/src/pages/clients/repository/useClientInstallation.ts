import type { Installation } from '#/pages/clients/types/installation';
import { readInstallation } from '#/pages/clients/adapter/operations';
import { installationKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/services/read';
import { useTransport } from '#/shared/transport/useTransport';

export function useClientInstallation(tenant: string, clientDbId: string): Read<Installation> {
  const { gateway } = useTransport();
  return useRead(installationKey(tenant, clientDbId), true, () =>
    readInstallation(gateway, tenant, clientDbId),
  );
}
