import type { ListedSubject } from '@odudu/contracts/admin';
import { readSubjectCount, readSubjectPage } from '#/features/subjects/adapter/subjects';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { ResourceListState } from '#/shared/services/resourceList';

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
