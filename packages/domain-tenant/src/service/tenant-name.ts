import { isTenantName, TENANT_NAME_PATTERN, TENANT_NAME_RULE } from '@odudu/contracts';

// The rule itself lives in @odudu/contracts, where the console reads it too;
// tenant-name-check.int.test.ts proves the migration's CHECK agrees with it.
export { TENANT_NAME_PATTERN, TENANT_NAME_RULE };
export const isValidTenantName = isTenantName;

// `count` is reserved because GET /admin/tenants/count would otherwise be
// shadowed by GET /admin/tenants/{a tenant named count}.
export const RESERVED_TENANT_NAMES = ['system', 'count'] as const;

export function isReservedTenantName(name: string): boolean {
  return (RESERVED_TENANT_NAMES as readonly string[]).includes(name);
}
