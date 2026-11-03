import { useClientList } from '#/pages/clients/repository/useClientList';
import { type Client, clientHref, newClientHref } from '#/entities/client';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type ClientsList = ListPageState<Client>;

export function useClientsList(tenant: string): ClientsList {
  return useListPage(useClientList(tenant), newClientHref(tenant), (id) => clientHref(tenant, id));
}
