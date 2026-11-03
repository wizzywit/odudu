import { useClientInstallation } from '#/pages/clients/repository/useClientInstallation';
import {
  INSTALLATION_HEADING,
  INSTALLATION_RULE,
  installationRows,
  NONE,
  type InstallationRow,
} from '#/pages/clients/services/installation';
import { mapRead, type Read } from '#/shared/lib/services/read';

export interface InstallationPanel {
  heading: string;
  rule: string;
  // What a row with no value says.
  none: string;
  read: Read<readonly InstallationRow[]>;
}

export function useInstallationPanel(tenant: string, clientDbId: string): InstallationPanel {
  return {
    heading: INSTALLATION_HEADING,
    rule: INSTALLATION_RULE,
    none: NONE,
    read: mapRead(useClientInstallation(tenant, clientDbId), installationRows),
  };
}
