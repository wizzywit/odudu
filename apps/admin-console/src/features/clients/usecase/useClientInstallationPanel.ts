import { useClientInstallation } from '#/features/clients/repository/useClientInstallation.ts';
import { installationRows, type InstallationRow } from '#/features/clients/service';

export type InstallationPanel =
  | { status: 'loading' }
  | { status: 'ready'; rows: readonly InstallationRow[] }
  | { status: 'failed'; refused: boolean; retry: () => void };

export function useInstallationPanel(tenant: string, clientDbId: string): InstallationPanel {
  const read = useClientInstallation(tenant, clientDbId);
  if (read.status === 'ready') return { status: 'ready', rows: installationRows(read.data) };
  return read.status === 'loading'
    ? { status: 'loading' }
    : { status: 'failed', refused: read.refused, retry: read.retry };
}
