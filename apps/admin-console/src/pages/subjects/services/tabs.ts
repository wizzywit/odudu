import type { SubjectTab } from '#/entities/subject';

const model: { labels: Readonly<Record<SubjectTab, string>> } = {
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
};

export const SUBJECT_TAB_LABELS = model.labels;
