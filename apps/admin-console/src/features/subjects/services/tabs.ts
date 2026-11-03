import { recordTabs } from '#/shared/services/record';
import { SUBJECT_TABS, type SubjectTab } from '#/features/subjects/services/subjectAddress';
import {
  subjectRecord,
  profileRecord,
  groupsRecord,
  rolesRecord,
  actionsRecord,
} from '#/features/subjects/services/subjectRecords';

const model = recordTabs({
  tabs: SUBJECT_TABS,
  labels: {
    profile: 'Profile',
    credentials: 'Credentials',
    groups: 'Groups',
    roles: 'Roles',
    'required-actions': 'Required actions',
    sessions: 'Sessions',
    consents: 'Consents',
    grants: 'Grants',
    activity: 'Activity',
  },
});

export const SUBJECT_TAB_LABELS = model.labels;

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<SubjectTab, (id: string) => readonly string[]>> = {
  profile: (id) => [subjectRecord(id), profileRecord(id)],
  credentials: () => [],
  groups: (id) => [groupsRecord(id)],
  roles: (id) => [rolesRecord(id)],
  'required-actions': (id) => [actionsRecord(id)],
  sessions: () => [],
  consents: () => [],
  grants: () => [],
  activity: () => [],
};
