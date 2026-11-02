import type { Subject } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useGo } from '#/shared/repository/useGo';
import { useMemberList } from '#/features/subjects/repository/useMemberList';
import { membersListHref, subjectHref } from '#/features/subjects/services/address';
import { notLacking } from '#/shared/services/access';
import type { ResourceListState } from '#/shared/services/resourceList';

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
