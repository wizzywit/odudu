import type { Subject } from '@odudu/contracts/admin';
import { readSubjectCount, readSubjectPage } from '#/features/subjects/adapter/subjects';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { ResourceListState } from '#/shared/services/resourceList';

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
