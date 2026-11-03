import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { readSubjectCount, readSubjectPage, type Subject } from '#/entities/subject';

export function useSubjectList(tenant: string): ResourceListState<Subject> {
  return useResourceList({
    tenant,
    resource: 'subjects',
    search: ['username', 'email'],
    filters: ['enabled', 'capability', 'role', 'group'],
    read: (gateway, query) => readSubjectPage(gateway, tenant, query),
    count: (gateway, query) => readSubjectCount(gateway, tenant, query),
  });
}
