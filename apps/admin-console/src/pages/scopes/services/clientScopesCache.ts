// A client as the console holds it after an assignment changed its scopes.
export function withScopes<S, C extends { scopes: readonly S[] }>(
  client: C,
  scopes: readonly S[],
): C {
  return { ...client, scopes };
}

export function withoutScope<C extends { scopes: readonly { id: string }[] }>(
  client: C,
  scopeId: string,
): C {
  return { ...client, scopes: client.scopes.filter((scope) => scope.id !== scopeId) };
}
