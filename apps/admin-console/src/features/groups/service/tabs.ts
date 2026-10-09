export const GROUP_TABS = ['general', 'roles', 'members', 'activity'] as const;

export type GroupTab = (typeof GROUP_TABS)[number];

export const GROUP_TAB_LABELS: Readonly<Record<GroupTab, string>> = {
  general: 'General',
  roles: 'Roles',
  members: 'Members',
  activity: 'Activity',
};

export function groupRecord(id: string): string {
  return `groups/${id}`;
}

export function groupRolesRecord(id: string): string {
  return `groups/${id}/roles`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<GroupTab, (id: string) => readonly string[]>> = {
  general: (id) => [groupRecord(id)],
  roles: (id) => [groupRolesRecord(id)],
  members: () => [],
  activity: () => [],
};
