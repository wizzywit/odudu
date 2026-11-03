export function listKey(tenant: string, ...resource: readonly string[]) {
  return ['list', tenant, ...resource] as const;
}

export function recordKey(tenant: string, record: string) {
  return ['record', tenant, record] as const;
}
