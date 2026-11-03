import { clientsTrail } from '#/entities/client';
import { CLIENT_TITLE } from '#/pages/clients/services/clientDetails';
import { NEW_CLIENT_TITLE } from '#/pages/clients/services/newClient';

export interface PageFrame {
  title: string;
  breadcrumb: ReturnType<typeof clientsTrail>;
}

// What the area gate shows in place of a page it does not let through.
export interface ClientFrame {
  record: PageFrame;
  creation: PageFrame;
}

export function useClientFrame(tenant: string): ClientFrame {
  return {
    record: { title: CLIENT_TITLE, breadcrumb: clientsTrail(tenant, CLIENT_TITLE) },
    creation: { title: NEW_CLIENT_TITLE, breadcrumb: clientsTrail(tenant, NEW_CLIENT_TITLE) },
  };
}
