import { refusedBy, writeFailureText } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { GatewayFailure } from '#/shared/services/result';

export function clientsCount(shown: number, more: boolean): string {
  return more
    ? `${counted(shown, 'client', 'clients')} shown, with more to load.`
    : `${counted(shown, 'client', 'clients')}.`;
}

// A lost answer is never sent again; the list says whether it took.
export function clientAssignmentFailure(
  failure: GatewayFailure,
  scope: string,
  client: string,
  verb: 'assigned' | 'unassigned',
): string {
  return writeFailureText(failure, {
    name: `${scope} for ${client}`,
    verb,
    lookAt: "the scope's clients",
    refused: refusedBy(),
  });
}

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

// Whoami has answered and names no capability missing for the client search.
export function clientsOffered(known: boolean, needs: readonly string[]): boolean {
  return known && needs.length === 0;
}

export function chosenClient<C extends { id: string }>(
  options: readonly C[],
  id: string | null,
): C | null {
  return options.find((option) => option.id === id) ?? null;
}
