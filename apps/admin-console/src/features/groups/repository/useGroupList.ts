import type { Group } from '@odudu/contracts/admin';
import { readGroupCount, readGroupPage } from '#/features/groups/adapter/groups.ts';
import { useListPages, useResourceList } from '#/shared/repository/useResourceList.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface GroupList {
  list: ResourceListState<Group>;
  // A search reaches every level; without one, the list is the top of the tree.
  searching: boolean;
}

export function useGroupList(tenant: string): GroupList {
  const { params } = useUrlSearch();
  const searching = (params.get('q') ?? '') !== '';
  const list = useResourceList({
    tenant,
    resource: 'groups',
    search: ['name'],
    fixed: searching ? {} : { parent: 'root' },
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
    count: (gateway, query) => readGroupCount(gateway, tenant, query),
  });
  return { list, searching };
}

// One level beneath a group, read only once it is opened.
export function useGroupChildren(tenant: string, id: string, open: boolean) {
  return useListPages({
    key: ['list', tenant, 'groups', 'children', id],
    query: new URLSearchParams({ parent: id }),
    cursor: undefined,
    read: (gateway, query) => readGroupPage(gateway, tenant, query),
    enabled: open,
  });
}
