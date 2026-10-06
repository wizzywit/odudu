import type { Client } from '@odudu/contracts/admin';
import { useClientList } from '#/features/clients/repository/useClientList.ts';
import { useGo } from '#/shared/repository/useGo.ts';
import { clientHref, newClientHref } from '#/features/clients/service';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface ClientsList {
  list: ResourceListState<Client>;
  createHref: string;
  open: (id: string) => void;
}

export function useClientsList(tenant: string): ClientsList {
  const list = useClientList(tenant);
  const go = useGo();
  return {
    list,
    createHref: newClientHref(tenant),
    open: (id) => {
      go(clientHref(tenant, id));
    },
  };
}
