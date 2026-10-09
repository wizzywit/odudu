import type { Role } from '@odudu/contracts/admin';
import { readRolePage } from '#/shared/adapter/directory.ts';
import { usePicker } from '#/shared/repository/usePicker.ts';
import type { PickerState } from '#/shared/service/picker.ts';

// `client` narrows to one owner: `tenant` for the tenant's own roles, or a
// client's id for the roles scoped to it.
export function useRolePicker(
  tenant: string,
  { client }: { client?: string } = {},
): PickerState<Role> {
  return usePicker({
    tenant,
    resource: 'roles',
    fixed: client === undefined ? {} : { client },
    read: (gateway, query) => readRolePage(gateway, tenant, query),
  });
}
