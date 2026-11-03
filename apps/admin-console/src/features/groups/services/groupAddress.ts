import { type Group, type GroupRecord } from '@odudu/contracts/admin';
import { resourceAddress, withSearch } from '#/shared/services/address';

export type { Group, GroupRecord };

const groups = resourceAddress({ segment: 'groups', group: 'Identity', label: 'Groups' });

export const { listHref: groupsHref, recordHref: groupHref, trail: groupsTrail } = groups;

export function newGroupHref(tenant: string, parent?: string): string {
  return withSearch(`${groupsHref(tenant)}/new`, { parent });
}
