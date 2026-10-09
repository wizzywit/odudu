import { subjectHref } from '#/features/subjects/service/address.ts';

// A subject's record, a tab per concern, in the order the page shows them.
export const SUBJECT_TABS = [
  'profile',
  'credentials',
  'groups',
  'roles',
  'required-actions',
  'sessions',
  'consents',
  'grants',
  'activity',
] as const;

export type SubjectTab = (typeof SUBJECT_TABS)[number];

export const SUBJECT_TAB_LABELS: Readonly<Record<SubjectTab, string>> = {
  profile: 'Profile',
  credentials: 'Credentials',
  groups: 'Groups',
  roles: 'Roles',
  'required-actions': 'Required actions',
  sessions: 'Sessions',
  consents: 'Consents',
  grants: 'Grants',
  activity: 'Activity',
};

export function subjectTabHref(tenant: string, id: string, tab: SubjectTab): string {
  return `${subjectHref(tenant, id)}?tab=${tab}`;
}

export function subjectRecord(id: string): string {
  return `subjects/${id}`;
}

export function profileRecord(id: string): string {
  return `subjects/${id}/profile`;
}

export function groupsRecord(id: string): string {
  return `subjects/${id}/groups`;
}

export function rolesRecord(id: string): string {
  return `subjects/${id}/roles`;
}

export function actionsRecord(id: string): string {
  return `subjects/${id}/required-actions`;
}

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
