import type { Subject } from '@odudu/contracts/admin';
import { readSubjectPage } from '#/shared/adapter/directory';
import { usePicker } from '#/shared/repository/usePicker';
import type { PickerState } from '#/shared/services/picker';

// The tenant's subjects to choose from, searched by username on the server.
export function useSubjectPicker(tenant: string): PickerState<Subject> {
  return usePicker({
    tenant,
    resource: 'subjects',
    field: 'username',
    read: (gateway, query) => readSubjectPage(gateway, tenant, query),
  });
}
