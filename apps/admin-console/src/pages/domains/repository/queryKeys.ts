// What a switch to one address would do to the passkeys of the tenant, read
// when the switch is asked for and again once the domains change.
export function passkeyImpactKey(tenant: string, target: string) {
  return ['passkey-impact', tenant, target] as const;
}

// Every passkey-impact read of a tenant, whichever address it asked about.
export function passkeyImpactsKey(tenant: string) {
  return ['passkey-impact', tenant] as const;
}
