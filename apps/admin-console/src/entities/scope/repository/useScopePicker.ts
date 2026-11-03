import { readScopePage } from '#/entities/scope/adapter/scopePage';
import { usePicker } from '#/shared/lib/repository/usePicker';
import type { PickerState } from '#/shared/lib/services/picker';
import type { Scope } from '#/entities/scope/types/scope';

// The tenant's scopes, searched by name on the server a page at a time.
export function useScopePicker(tenant: string): PickerState<Scope> {
  return usePicker({
    tenant,
    resource: 'scopes',
    read: (gateway, query) => readScopePage(gateway, tenant, query),
  });
}
