import type { ClientInstallation } from '@odudu/contracts/admin';
import { readInstallation } from '#/features/clients/adapter/operations.ts';
import { useRead, type Read } from '#/shared/repository/useRead.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function useClientInstallation(
  tenant: string,
  clientDbId: string,
): Read<ClientInstallation> {
  const { gateway } = useTransport();
  return useRead(['installation', tenant, clientDbId], true, () =>
    readInstallation(gateway, tenant, clientDbId),
  );
}
