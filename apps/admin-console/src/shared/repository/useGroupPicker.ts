import type { Group } from '@odudu/contracts/admin';
import { readGroupPage } from '#/shared/adapter/directory.ts';
import { usePicker } from '#/shared/repository/usePicker.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export function useGroupPicker(tenant: string): PickerState<Group> {
  return usePicker({
    tenant,
    resource: 'groups',
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
  });
}
