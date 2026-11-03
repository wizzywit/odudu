export function scopeClientsKey(tenant: string, ...scope: readonly string[]) {
  return ['scope-clients', tenant, ...scope] as const;
}
