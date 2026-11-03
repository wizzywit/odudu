import type { Subject } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal, isSelf } from '#/entities/session';
import { useHeldCapabilities } from '#/features/subjects/repository/useAccess';
import { useSubjectRecord } from '#/features/subjects/repository/useSubjectRecord';
import { TAB_RECORDS } from '#/features/subjects/services/tabs';
import { lacking } from '#/shared/services/access';
import { type AdminCapability } from '#/shared/services/principal';
import type { RecordView } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';
import { SUBJECT_TABS, type SubjectTab } from '#/features/subjects/services/subjectAddress';
import {
  canManageSubject,
  reachOf,
  subjectBeyond,
} from '#/features/subjects/services/subjectReach';

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
  const tabs = useRecordTabs(SUBJECT_TABS, TAB_RECORDS, tenant, id);
  const changeNeeds = lacking(authority, ['manage-users']);
  const effective = useHeldCapabilities(tenant, id);
  const beyond = subjectBeyond(effective, authority?.capabilities);
  return {
    record,
    subject: record.data,
    etag: record.etag,
    ...tabs,
    canManage: canManageSubject(changeNeeds, effective.status, beyond),
    changeNeeds,
    beyond,
    reach: reachOf(effective),
    self: isSelf(principal, tenant, id),
  };
}
