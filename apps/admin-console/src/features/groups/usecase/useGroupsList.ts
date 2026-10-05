import type { Group } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useGo } from '#/features/groups/repository/useGo.ts';
import { useGroupChildren, useGroupList } from '#/features/groups/repository/useGroupList.ts';
import { groupHref, newGroupHref } from '#/features/groups/service';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface GroupsList {
  list: ResourceListState<Group>;
  searching: boolean;
  createHref: string;
  open: (id: string) => void;
}

export function useGroupsList(tenant: string): GroupsList {
  const { list, searching } = useGroupList(tenant);
  const go = useGo();
  return {
    list,
    searching,
    createHref: newGroupHref(tenant),
    open: (id) => {
      go(groupHref(tenant, id));
    },
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
