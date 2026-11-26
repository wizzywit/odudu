import type { GatewayResult } from '#/shared/lib/services/result';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';

// The id of a conversation that was just started, or the refusal as the error
// the panel words, so the caller has no outcome to choose between.
export function startedId(created: GatewayResult<{ id: string }>): string {
  if (!created.ok) throw new ChatCallError(created, 'start');
  return created.data.id;
}
