export const TENANT_TABS = ['general', 'administrators', 'export'] as const;

export type TenantTab = (typeof TENANT_TABS)[number];

// The record's name among the drafts and caches it keeps.
export function tenantRecord(name: string): string {
  return `tenants/${name}`;
}
