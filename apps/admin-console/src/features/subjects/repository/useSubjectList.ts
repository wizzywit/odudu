import type { Subject } from '@odudu/contracts/admin';
import { readSubjectCount, readSubjectPage } from '#/features/subjects/adapter/subjects.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

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
