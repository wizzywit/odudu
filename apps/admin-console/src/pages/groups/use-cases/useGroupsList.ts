import { useState } from 'react';
import { useGroupChildren, useGroupList } from '#/pages/groups/repository/useGroupList';
import { type Group, groupHref, newGroupHref } from '#/entities/group';
import { NAME_SEARCH } from '#/shared/lib/services/filters';
import { useListPage, type ListPageState } from '#/shared/lib/use-cases/useListPage';

export interface GroupsList extends ListPageState<Group> {
  searching: boolean;
  searchFields: readonly { id: string; label: string }[];
}

export function useGroupsList(tenant: string): GroupsList {
  const { list, searching } = useGroupList(tenant);
  const page = useListPage(list, newGroupHref(tenant), (id) => groupHref(tenant, id));
  return {
    list: page.list,
    createHref: page.createHref,
    open: page.open,
    searching,
    searchFields: NAME_SEARCH,
  };
}

export interface GroupNode {
  href: string;
  open: boolean;
  toggle: () => void;
  children: ReturnType<typeof useGroupChildren>;
}

export function useGroupNode(tenant: string, group: Group): GroupNode {
  const [open, setOpen] = useState(false);
  const children = useGroupChildren(tenant, group.id, open);
  return {
    href: groupHref(tenant, group.id),
    open,
    toggle: () => {
      setOpen((was) => !was);
    },
    children,
  };
}
