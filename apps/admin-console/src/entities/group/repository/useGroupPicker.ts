import { readGroupPage } from '#/entities/group/adapter/groupPage';
import { usePicker } from '#/shared/repository/usePicker';
import type { PickerState } from '#/shared/services/picker';
import type { Group } from '#/entities/group/types/group';

export function useGroupPicker(tenant: string): PickerState<Group> {
  return usePicker({
    tenant,
    resource: 'groups',
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
  });
}
