export function roleOnlyKey(tenant: string) {
  return ['role-only', tenant] as const;
}
