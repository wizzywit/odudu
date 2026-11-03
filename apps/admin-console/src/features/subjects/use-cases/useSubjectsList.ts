import { useAuthority } from '#/entities/session';
import { useSubjectList } from '#/features/subjects/repository/useSubjectList';
import { lacking } from '#/shared/services/access';
import type { AdminCapability } from '#/shared/services/principal';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';
import { createSubjectHref } from '#/features/subjects/services/newSubject';
import { subjectHref } from '#/features/subjects/services/subjectAddress';
import { type Subject } from '#/entities/subject';

// `createHref` is null while whoami says creating would be refused.
export interface SubjectsList extends ListPageState<Subject, string | null> {
  // What changing a subject needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
}

export function useSubjectsList(tenant: string): SubjectsList {
  const list = useSubjectList(tenant);
  const authority = useAuthority(tenant);
  const changeNeeds = lacking(authority, ['manage-users']);
  return {
    ...useListPage(list, createSubjectHref(tenant, authority), (id) => subjectHref(tenant, id)),
    changeNeeds,
  };
}
