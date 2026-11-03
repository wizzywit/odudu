import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { readSubjectCount, readSubjectPage, type Subject } from '#/entities/subject';

// The subjects a group or a role names directly, by the subjects list's own filter.
export function useMemberList(
  tenant: string,
  by: 'group' | 'role',
  id: string,
): ResourceListState<Subject> {
  return useResourceList({
    tenant,
    resource: `subjects/${by}/${id}`,
    search: ['username'],
    fixed: { [by]: id },
    read: (gateway, query) => readSubjectPage(gateway, tenant, query),
    count: (gateway, query) => readSubjectCount(gateway, tenant, query),
  });
}
