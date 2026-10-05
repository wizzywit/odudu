import type { Subject } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import { useMemberList } from '#/features/subjects/repository/useMemberList.ts';
import { membersListHref, subjectHref } from '#/features/subjects/service';
import { notLacking } from '#/shared/service/access.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// whoami is advice: a caller it says cannot read subjects is told so, rather
// than sent a read the server would refuse.
export function useMembersReadable(tenant: string): boolean {
  return notLacking(useAuthority(tenant), ['view-users']);
}

export interface Members {
  list: ResourceListState<Subject>;
  // The same subjects in the Subjects list, where every other filter applies.
  listHref: string;
  open: (id: string) => void;
}

export function useMembers(tenant: string, by: 'group' | 'role', id: string): Members {
  const list = useMemberList(tenant, by, id);
  const go = useGo();
  return {
    list,
    listHref: membersListHref(tenant, by, id),
    open: (subject) => {
      go(subjectHref(tenant, subject));
    },
  };
}
