// One run read on its own, read again each time its details are opened.
export function agentKey(tenant: string, id?: string) {
  return id === undefined ? (['agent', tenant] as const) : (['agent', tenant, id] as const);
}

// What revoking one run would end, read again each time the revoke is asked.
export function revokeCountKey(tenant: string, id: string) {
  return ['agent-revoke-count', tenant, id] as const;
}
