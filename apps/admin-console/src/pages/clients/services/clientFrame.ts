import { CLIENT_TITLE } from '#/pages/clients/services/clientDetails';
import { NEW_CLIENT_TITLE } from '#/pages/clients/services/newClient';
import { pageFrame, type PageFrame } from '#/shared/lib/services/address';

export interface ClientFrames {
  record: PageFrame;
  creation: PageFrame;
}

export function clientFrames(tenant: string, trail: Parameters<typeof pageFrame>[0]): ClientFrames {
  return {
    record: pageFrame(trail, tenant, CLIENT_TITLE),
    creation: pageFrame(trail, tenant, NEW_CLIENT_TITLE),
  };
}
