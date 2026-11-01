// Scope only ever narrows, never widens: requested ∩ client-allowed, then
// narrowed further by consent and by delegation when either applies. P1 has
// no consent screen, so `consented` is always null here — null means "not
// applicable", not "nothing", or intersecting it would issue no scopes at
// all. `delegated` is inert in the same way until P5's attenuation check
// supplies it; the parameter exists now so that arrival needs no change to
// this function's shape.
export function resolveScope(
  requested: string,
  clientAllowed: string[],
  consented: string[] | null,
  delegated: string[] | null,
): string[] {
  const requestedTokens = requested.split(' ').filter((token) => token.length > 0);
  const allowedSet = new Set(clientAllowed);

  let scope = requestedTokens.filter((token) => allowedSet.has(token));

  if (consented !== null) {
    const consentedSet = new Set(consented);
    scope = scope.filter((token) => consentedSet.has(token));
  }

  if (delegated !== null) {
    const delegatedSet = new Set(delegated);
    scope = scope.filter((token) => delegatedSet.has(token));
  }

  return scope;
}

// The scopes a client asks for when a request names none: its default
// assignments in one fixed order, since the database returns them in no order
// of its own and a scope string is read by people.
export function defaultScopeNames(
  rows: readonly {
    scope: { name: string; displayOrder: number };
    assignment: 'default' | 'optional';
  }[],
): string[] {
  return rows
    .filter((row) => row.assignment === 'default')
    .map((row) => row.scope)
    .sort(
      (a, b) =>
        Number(b.name === 'openid') - Number(a.name === 'openid') ||
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name, 'en'),
    )
    .map((scope) => scope.name);
}
