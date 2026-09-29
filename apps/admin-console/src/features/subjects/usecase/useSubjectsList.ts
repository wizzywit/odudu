import type { Subject } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import { useSubjectList } from '#/features/subjects/repository/useSubjectList.ts';
import { newSubjectHref, subjectHref } from '#/features/subjects/service.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface SubjectsList {
  readonly list: ResourceListState<Subject>;
  // Null while whoami says creating would be refused.
  readonly createHref: string | null;
  readonly open: (id: string) => void;
}

export function useSubjectsList(tenant: string): SubjectsList {
  const list = useSubjectList(tenant);
  const authority = useAuthority(tenant);
  const go = useGo();
  return {
    list,
    createHref:
      authority === undefined || holds(authority, 'manage-users') ? newSubjectHref(tenant) : null,
    open: (id) => {
      go(subjectHref(tenant, id));
    },
  };
}
