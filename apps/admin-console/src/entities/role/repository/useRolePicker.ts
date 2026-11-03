import { readRolePage } from '#/entities/role/adapter/rolePage';
import { usePicker } from '#/shared/repository/usePicker';
import { optionalFilter } from '#/shared/services/filters';
import type { PickerState } from '#/shared/services/picker';
import type { Role } from '#/entities/role/types/role';

// `client` narrows to one owner: `tenant` for the tenant's own roles, or a
// client's id for the roles scoped to it.
export function useRolePicker(
  tenant: string,
  { client }: { client?: string } = {},
): PickerState<Role> {
  return usePicker({
    tenant,
    resource: 'roles',
    fixed: optionalFilter('client', client),
    read: (gateway, query) => readRolePage(gateway, tenant, query),
  });
}
