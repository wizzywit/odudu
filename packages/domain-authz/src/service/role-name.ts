// A tenant role is bare, a client role is qualified by its owning client.
// The database refuses `:` in a role name, so the qualified form cannot be
// ambiguous and this join needs no escaping.
export function qualifiedRoleName(
  role: { readonly name: string },
  clientKey: string | null,
): string {
  return clientKey === null ? role.name : `${clientKey}:${role.name}`;
}
