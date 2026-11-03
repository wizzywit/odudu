import { clientsTrail } from '#/entities/client';
import { clientFrames, type ClientFrames } from '#/pages/clients/services/clientFrame';

export function useClientFrame(tenant: string): ClientFrames {
  return clientFrames(tenant, clientsTrail);
}
