import { useClientList } from '#/pages/clients/repository/useClientList';
import { TYPE_TEXT } from '#/pages/clients/services/clientDetails';
import { type Client, clientHref, newClientHref } from '#/entities/client';
import { STATUS_FILTER } from '#/shared/lib/services/filters';
import { useListPage, type ListPageState } from '#/shared/lib/use-cases/useListPage';

export interface ClientsList extends ListPageState<Client> {
  // How each client type reads in the Type column.
  typeText: Readonly<Record<string, string>>;
  statusFilter: readonly { id: string; label: string }[];
}

export function useClientsList(tenant: string): ClientsList {
  const page = useListPage(useClientList(tenant), newClientHref(tenant), (id) =>
    clientHref(tenant, id),
  );
  return {
    list: page.list,
    createHref: page.createHref,
    open: page.open,
    typeText: TYPE_TEXT,
    statusFilter: STATUS_FILTER,
  };
}
