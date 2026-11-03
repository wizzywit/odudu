import { readClientPage } from '#/entities/client/adapter/clientPage';
import { usePicker } from '#/shared/lib/repository/usePicker';
import type { PickerState } from '#/shared/lib/services/picker';
import type { Client } from '#/entities/client/types/client';

// A tenant can hold thousands of clients, so a search is a prefix of the name
// answered by the server a page at a time.
export function useClientPicker(tenant: string, enabled = true): PickerState<Client> {
  return usePicker({
    tenant,
    resource: 'clients',
    enabled,
    read: (gateway, query) => readClientPage(gateway, tenant, query),
  });
}
