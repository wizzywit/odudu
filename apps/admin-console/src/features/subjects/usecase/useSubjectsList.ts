import type { Subject } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import { useSubjectList } from '#/features/subjects/repository/useSubjectList.ts';
import { newSubjectHref, subjectHref } from '#/features/subjects/service.ts';
import { lacking } from '#/shared/service/access.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface SubjectsList {
  list: ResourceListState<Subject>;
  // Null while whoami says creating would be refused.
  createHref: string | null;
  // What changing a subject needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  open: (id: string) => void;
}

export function useSubjectsList(tenant: string): SubjectsList {
  const list = useSubjectList(tenant);
  const authority = useAuthority(tenant);
  const go = useGo();
  const changeNeeds = lacking(authority, ['manage-users']);
  return {
    list,
    createHref: changeNeeds.length === 0 ? newSubjectHref(tenant) : null,
    changeNeeds,
    open: (id) => {
      go(subjectHref(tenant, id));
    },
  };
}
