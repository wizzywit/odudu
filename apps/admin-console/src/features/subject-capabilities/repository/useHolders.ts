import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { readSubjectCount, readSubjectPage, type ListedSubject } from '#/entities/subject';

// Every holder of an admin capability, a page at a time, each carrying what
// it holds; `capability` narrows to the holders of one.
export function useHolderList(tenant: string): ResourceListState<ListedSubject> {
  return useResourceList({
    tenant,
    resource: 'holders',
    search: ['username'],
    filters: ['enabled', 'capability'],
    defaults: { capability: 'any' },
    read: (gateway, query) => readSubjectPage(gateway, tenant, query),
    count: (gateway, query) => readSubjectCount(gateway, tenant, query),
  });
}
