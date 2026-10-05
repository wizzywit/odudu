import type { Subject } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal } from '#/features/session';
import { useEffectiveRoles } from '#/features/subjects/repository/useAccess.ts';
import { useDirtyRecords } from '#/shared/repository/useDirtyRecords.ts';
import { useSubjectRecord } from '#/features/subjects/repository/useSubjectRecord.ts';
import {
  canManageSubject,
  reachOf,
  SUBJECT_TABS,
  subjectBeyond,
  TAB_RECORDS,
  type SubjectTab,
} from '#/features/subjects/service.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { lacking } from '#/shared/service/access.ts';
import { isSelf, type AdminCapability } from '#/shared/service/principal.ts';
import { dirtyTabs, tabNamed, type RecordView } from '#/shared/service/record.ts';

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
  // Admin capabilities the subject holds and the caller does not: every
  // write on its record is then refused (ADR 0040's target ceiling).
  beyond: readonly AdminCapability[];
  // Whether what the subject holds has been read: until it has, no write is
  // offered, since the ceiling cannot be judged.
  reach: 'checking' | 'ready' | { failed: true; retry: () => void };
}

export function useSubjectRecordPage(tenant: string, id: string): SubjectRecordPage {
  const record = useSubjectRecord(tenant, id);
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const { tab, selectTab } = useRecordTab(SUBJECT_TABS);
  const changeNeeds = lacking(authority, ['manage-users']);
  const effective = useEffectiveRoles(tenant, id);
  const beyond = subjectBeyond(effective, authority?.capabilities);
  const recordsOf = (each: SubjectTab): readonly string[] => TAB_RECORDS[each](id);
  const edited = useDirtyRecords(tenant, SUBJECT_TABS.flatMap(recordsOf));
  return {
    record,
    subject: record.data,
    etag: record.etag,
    tab,
    selectTab: (next) => {
      const chosen = tabNamed(SUBJECT_TABS, next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty: dirtyTabs(SUBJECT_TABS, recordsOf, edited),
    canManage: canManageSubject(changeNeeds, effective.status, beyond),
    changeNeeds,
    beyond,
    reach: reachOf(effective),
    self: isSelf(principal, tenant, id),
  };
}
