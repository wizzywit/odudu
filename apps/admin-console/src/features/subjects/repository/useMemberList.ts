import type { Subject } from '@odudu/contracts/admin';
import { readSubjectCount, readSubjectPage } from '#/features/subjects/adapter/subjects.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

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
