import { useClientInstallation } from '#/pages/clients/repository/useClientInstallation';
import { installationRows, type InstallationRow } from '#/pages/clients/services/installation';
import { mapRead, type Read } from '#/shared/services/read';

export function useInstallationPanel(
  tenant: string,
  clientDbId: string,
): Read<readonly InstallationRow[]> {
  return mapRead(useClientInstallation(tenant, clientDbId), installationRows);
}
