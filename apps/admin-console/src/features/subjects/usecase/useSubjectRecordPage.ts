import type { Subject } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal } from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
import {
  profileRecord,
  subjectRecord,
  useSubjectRecord,
} from '#/features/subjects/repository/useSubjectRecord.ts';
import { SUBJECT_TABS, type SubjectTab } from '#/features/subjects/service.ts';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import type { RecordView } from '#/shared/service/record.ts';

export interface SubjectRecordPage {
  readonly record: RecordView;
  readonly subject: Subject | undefined;
  readonly etag: string | null;
  readonly tab: SubjectTab;
  readonly selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  readonly dirty: ReadonlySet<SubjectTab>;
  // False once whoami says a change would be refused; true until it answers.
  readonly canManage: boolean;
  // The principal looking is this subject.
  readonly self: boolean;
}

export function useSubjectRecordPage(tenant: string, id: string): SubjectRecordPage {
  const record = useSubjectRecord(tenant, id);
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const { tab, selectTab } = useRecordTab(SUBJECT_TABS);
  const account = useDirtySections(tenant, subjectRecord(id));
  const profile = useDirtySections(tenant, profileRecord(id));
  const dirty = new Set<SubjectTab>(account.size + profile.size > 0 ? ['profile'] : []);
  return {
    record,
    subject: record.data,
    etag: record.etag,
    tab,
    selectTab: (next) => {
      const chosen = SUBJECT_TABS.find((candidate) => candidate === next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty,
    canManage: authority === undefined || holds(authority, 'manage-users'),
    self: principal.tenant === tenant && principal.subjectId === id,
  };
}
