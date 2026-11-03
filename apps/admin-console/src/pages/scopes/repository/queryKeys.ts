// What deleting one scope would take with it, read again each time it is asked.
export function scopeImpactKey(tenant: string, scope: string) {
  return ['scope-impact', tenant, scope] as const;
}

// Which built-in scopes a tenant has, read again each time the restore is asked.
export function builtinScopesKey(tenant: string) {
  return ['builtin-scopes', tenant] as const;
}
