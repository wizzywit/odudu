// One conversation's replay, read again each time it is opened or reported.
export function replayKey(tenant: string, id?: string) {
  return id === undefined
    ? (['assistant-replay', tenant] as const)
    : (['assistant-replay', tenant, id] as const);
}

// The test case a conversation exports, read fresh for each save.
export function caseKey(tenant: string, id: string) {
  return ['assistant-case', tenant, id] as const;
}
