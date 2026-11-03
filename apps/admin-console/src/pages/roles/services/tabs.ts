import { recordTabs } from '#/shared/services/record';

const model = recordTabs({
  tabs: ['general', 'composites', 'members', 'activity'] as const,
  labels: {
    general: 'General',
    composites: 'Composites',
    members: 'Members',
    activity: 'Activity',
  },
});

export const ROLE_TABS = model.tabs;
export const ROLE_TAB_LABELS = model.labels;
export const roleTabHrefOf = model.hrefOf;

export type RoleTab = (typeof ROLE_TABS)[number];

export function roleRecord(id: string): string {
  return `roles/${id}`;
}

export function compositesRecord(id: string): string {
  return `roles/${id}/composites`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<RoleTab, (id: string) => readonly string[]>> = {
  general: (id) => [roleRecord(id)],
  composites: (id) => [compositesRecord(id)],
  members: () => [],
  activity: () => [],
};
