import { conversationRepository } from '#/repository/conversations';
import type { TurnRegistry } from '#/service/turn-registry';
import type { ChatCaller, ChatDeps } from '#/usecase/chat-deps';

/**
 * Ends the conversation's running turn if this process runs it. A conversation
 * that is not the caller's is reported as not there, whatever is running.
 */
export async function stopTurn(
  deps: ChatDeps,
  registry: TurnRegistry,
  caller: ChatCaller,
  id: string,
): Promise<'stopped' | 'idle' | 'not_found'> {
  const owner = await deps.transact(
    caller.tenantId,
    async (tx) => (await conversationRepository(tx).byId(id))?.ownerSubjectId,
  );
  if (owner !== caller.ownerSubjectId) return 'not_found';
  return registry.stop(id) ? 'stopped' : 'idle';
}
