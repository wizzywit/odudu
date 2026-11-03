import { readScopePage } from '#/shared/adapter/directory';
import { usePicker } from '#/shared/repository/usePicker';
import type { PickerState } from '#/shared/services/picker';
import type { Scope } from '#/entities/scope/types/scope';

// The tenant's scopes, searched by name on the server a page at a time.
export function useScopePicker(tenant: string): PickerState<Scope> {
  return usePicker({
    tenant,
    resource: 'scopes',
    read: (gateway, query) => readScopePage(gateway, tenant, query),
  });
}
