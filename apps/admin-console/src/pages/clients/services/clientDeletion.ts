import { BUILTIN_FIXED } from '#/pages/clients/services/clientDetails';
import { type Fixable } from '#/pages/clients/services/builtinFixed';

export function deleteFixed(client: Fixable): string | null {
  return client.builtin_admin ? `${client.client_id} cannot be deleted. ${BUILTIN_FIXED}` : null;
}
export function deleteConsequence(name: string): string {
  return `Deleting ${name} deletes the client and every role scoped to it, with the grants and composite edges that name those roles. An application that signs in through it can no longer do so. It cannot be undone.`;
}
