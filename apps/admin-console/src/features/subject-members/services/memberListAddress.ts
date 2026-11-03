import { withSearch } from '#/shared/lib/services/address';

export function membersListHref(listHref: string, by: 'group' | 'role', id: string): string {
  return withSearch(listHref, { [by]: id });
}
