import type { Group } from '@odudu/contracts/admin';
import { readGroupCount, readGroupPage } from '#/features/groups/adapter/groups';
import { groupListScope } from '#/features/groups/services/list';
import { listKey } from '#/shared/repository/queryKeys';
import { useListPages, useResourceList } from '#/shared/repository/useResourceList';
import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import type { ResourceListState } from '#/shared/services/resourceList';

export interface GroupList {
  list: ResourceListState<Group>;
  // A search reaches every level; without one, the list is the top of the tree.
  searching: boolean;
}

export function useGroupList(tenant: string): GroupList {
  const { params } = useUrlSearch();
  const { searching, fixed } = groupListScope(params.get('q'));
  const list = useResourceList({
    tenant,
    resource: 'groups',
    search: ['name'],
    fixed,
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
    count: (gateway, query) => readGroupCount(gateway, tenant, query),
  });
  return { list, searching };
}

// One level beneath a group, read only once it is opened.
export function useGroupChildren(tenant: string, id: string, open: boolean) {
  return useListPages({
    key: listKey(tenant, 'groups', 'children', id),
    query: new URLSearchParams({ parent: id }),
    cursor: undefined,
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
    enabled: open,
  });
}
