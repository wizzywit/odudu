import type { Subject } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal } from '#/features/session/index.ts';
import { useDirtyRecords } from '#/features/subjects/repository/useDirtyRecords.ts';
import { useSubjectRecord } from '#/features/subjects/repository/useSubjectRecord.ts';
import { SUBJECT_TABS, TAB_RECORDS, type SubjectTab } from '#/features/subjects/service.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { lacking } from '#/shared/service/access.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';

export interface SubjectRecordPage {
  record: RecordView;
  subject: Subject | undefined;
  etag: string | null;
  tab: SubjectTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<SubjectTab>;
  // False once whoami says a change would be refused; true until it answers.
  canManage: boolean;
  // What changing the subject needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // The principal looking is this subject.
  self: boolean;
}

export function useSubjectRecordPage(tenant: string, id: string): SubjectRecordPage {
  const record = useSubjectRecord(tenant, id);
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const { tab, selectTab } = useRecordTab(SUBJECT_TABS);
  const changeNeeds = lacking(authority, ['manage-users']);
  const edited = useDirtyRecords(
    tenant,
    SUBJECT_TABS.flatMap((each) => TAB_RECORDS[each](id)),
  );
  const dirty = new Set<SubjectTab>(
    SUBJECT_TABS.filter((each) => TAB_RECORDS[each](id).some((record) => edited.has(record))),
  );
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
    canManage: changeNeeds.length === 0,
    changeNeeds,
    self: principal.tenant === tenant && principal.subjectId === id,
  };
}
