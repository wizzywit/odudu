import { useAuthority } from '#/entities/session';
import { useGo } from '#/shared/lib/repository/useGo';
import { useMemberList } from '#/features/subject-members/repository/useMemberList';
import { notLacking } from '#/shared/lib/services/access';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { membersListHref } from '#/features/subject-members/services/memberListAddress';
import { type Subject, subjectHref, subjectName, subjectsHref } from '#/entities/subject';

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
  nameOf: (subject: Subject) => string;
}

export function useMembers(tenant: string, by: 'group' | 'role', id: string): Members {
  const list = useMemberList(tenant, by, id);
  const go = useGo();
  return {
    list,
    listHref: membersListHref(subjectsHref(tenant), by, id),
    nameOf: subjectName,
    open: (subject) => {
      go(subjectHref(tenant, subject));
    },
  };
}
