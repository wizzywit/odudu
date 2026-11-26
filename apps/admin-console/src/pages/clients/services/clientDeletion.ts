import { BUILTIN_FIXED } from '#/pages/clients/services/clientDetails';
import { builtinKind, type Fixable } from '#/pages/clients/services/builtinFixed';

export function deleteFixed(client: Fixable): string | null {
  const kind = builtinKind(client);
  if (kind === 'admin') return `${client.client_id} cannot be deleted. ${BUILTIN_FIXED}`;
  // Only the admin client cannot be switched off, so the others say how to.
  return kind === null
    ? null
    : `${client.name} is built in and cannot be deleted. Disable it to switch it off.`;
}
export function deleteConsequence(name: string): string {
  return `Deleting ${name} deletes the client and every role scoped to it, with the grants and composite edges that name those roles. An application that signs in through it can no longer do so. It cannot be undone.`;
}
