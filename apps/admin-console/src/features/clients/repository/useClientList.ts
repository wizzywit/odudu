import type { Client } from '@odudu/contracts/admin';
import { readClientCount, readClientPage } from '#/features/clients/adapter/clients.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// The server searches by prefix and pages by cursor; the console holds only
// the pages it has been asked for, whatever the tenant holds.
export function useClientList(tenant: string): ResourceListState<Client> {
  return useResourceList({
    tenant,
    resource: 'clients',
    search: ['name', 'client_id'],
    filters: ['type', 'enabled'],
    read: (gateway, query) => readClientPage(gateway, tenant, query),
    count: (gateway, query) => readClientCount(gateway, tenant, query),
  });
}
