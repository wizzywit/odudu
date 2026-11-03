import type { Client } from '#/entities/client';
import { useClientList } from '#/features/clients/repository/useClientList';
import { clientHref, newClientHref } from '#/features/clients/services/address';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type ClientsList = ListPageState<Client>;

export function useClientsList(tenant: string): ClientsList {
  return useListPage(useClientList(tenant), newClientHref(tenant), (id) => clientHref(tenant, id));
}
