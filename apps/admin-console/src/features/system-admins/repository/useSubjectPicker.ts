import type { Subject } from '@odudu/contracts/admin';
import { readAdministratorPage } from '#/shared/adapter/administrators.ts';
import { usePicker } from '#/shared/repository/usePicker.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

export function useSubjectPicker(): PickerState<Subject> {
  return usePicker({
    tenant: SYSTEM_TENANT,
    resource: 'subjects',
    field: 'username',
    read: (gateway, query) => readAdministratorPage(gateway, SYSTEM_TENANT, query),
  });
}
