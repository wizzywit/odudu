export const SCOPE_TABS = ['general', 'roles', 'mappers', 'clients', 'activity'] as const;

export type ScopeTab = (typeof SCOPE_TABS)[number];

export const SCOPE_TAB_LABELS: Readonly<Record<ScopeTab, string>> = {
  general: 'General',
  roles: 'Roles',
  mappers: 'Claim mappers',
  clients: 'Clients',
  activity: 'Activity',
};

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
