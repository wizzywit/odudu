import { withSearch } from '#/shared/services/address';
import { subjectsHref } from '#/features/subjects/services/subjectAddress';

export function membersListHref(tenant: string, by: 'group' | 'role', id: string): string {
  return withSearch(subjectsHref(tenant), { [by]: id });
}
