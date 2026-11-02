import { recordTabs } from '#/shared/services/record';

const model = recordTabs({
  tabs: ['general', 'roles', 'mappers', 'clients', 'activity'] as const,
  labels: {
    general: 'General',
    roles: 'Roles',
    mappers: 'Claim mappers',
    clients: 'Clients',
    activity: 'Activity',
  },
});

export const SCOPE_TABS = model.tabs;
export const SCOPE_TAB_LABELS = model.labels;

export type ScopeTab = (typeof SCOPE_TABS)[number];

export function scopeRecord(id: string): string {
  return `scopes/${id}`;
}

export function scopeRolesRecord(id: string): string {
  return `scopes/${id}/roles`;
}

export function scopeMappersRecord(id: string): string {
  return `scopes/${id}/mappers`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<ScopeTab, (id: string) => readonly string[]>> = {
  general: (id) => [scopeRecord(id)],
  roles: (id) => [scopeRolesRecord(id)],
  mappers: (id) => [scopeMappersRecord(id)],
  clients: () => [],
  activity: () => [],
};
