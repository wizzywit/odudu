import type { SubjectTab } from '#/entities/subject/services/subjectAddress';

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
export const SUBJECT_TAB_RECORDS: Readonly<Record<SubjectTab, (id: string) => readonly string[]>> =
  {
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
