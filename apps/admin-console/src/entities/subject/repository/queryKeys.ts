export function adminRolesKey(tenant: string) {
  return ['admin-roles', tenant] as const;
}

// The reads of one subject's sign-in state, each made stale by its own change.
export function subjectReadKey(
  read: 'credentials' | 'lockout',
  tenant: string,
  ...id: readonly string[]
) {
  return [read, tenant, ...id] as const;
}
