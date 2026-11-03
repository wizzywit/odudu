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

export interface SubjectTabEntry {
  id: SubjectTab;
  label: string;
  // The tab holds a section with unsaved edits.
  dirty: boolean;
}

export function subjectTabEntries(
  tabs: readonly SubjectTab[],
  dirty: ReadonlySet<SubjectTab>,
): SubjectTabEntry[] {
  return tabs.map((id) => ({ id, label: SUBJECT_TAB_LABELS[id], dirty: dirty.has(id) }));
}
