import type { Group } from '@odudu/contracts/admin';
import { readGroupPage } from '#/shared/adapter/directory';
import { usePicker } from '#/shared/repository/usePicker';
import type { PickerState } from '#/shared/services/picker';

export function useGroupPicker(tenant: string): PickerState<Group> {
  return usePicker({
    tenant,
    resource: 'groups',
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
  });
}
