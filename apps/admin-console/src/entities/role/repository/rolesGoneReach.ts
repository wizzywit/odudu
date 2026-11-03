import type { ChangeReach } from '#/shared/repository/useAfterChange';
import {
  GROUP_KIND,
  heldCapabilitiesKey,
  holdersKey,
  listKey,
  pickerKey,
} from '#/shared/repository/queryKeys';

// What a role going away, or its edges changing, alters in the console: the
// group reads, the role and group records that name it, the lists, the role
// picker and what anybody holds. A client's removal takes its roles with it.
export function rolesGoneReach(tenant: string): Pick<ChangeReach, 'kinds' | 'records' | 'keys'> {
  return {
    kinds: [GROUP_KIND],
    records: ['roles/', 'groups/'],
    keys: [
      listKey(tenant),
      pickerKey(tenant, 'roles'),
      heldCapabilitiesKey(tenant),
      holdersKey(tenant),
    ],
  };
}
