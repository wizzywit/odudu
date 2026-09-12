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
