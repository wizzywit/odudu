import { conversationRepository } from '#/repository/conversations';
import type { AssistantTx } from '#/repository/tx';
import { conversationIsCallers } from '#/service/conversation-access';
import type { ChatCaller } from '#/usecase/chat-deps';

/**
 * The id of the grant a conversation of the caller's acts under: the one it was
 * carried on under after a sign-in, else the grant stored under its own id.
 * One with no row names its own id, which is the grant stored under it; undefined
 * for one that is another person's or another tenant's.
 */
export async function conversationGrantId(
  tx: AssistantTx,
  caller: ChatCaller,
  id: string,
): Promise<string | undefined> {
  const record = await conversationRepository(tx).byId(id);
  if (record === undefined) return id;
  return conversationIsCallers(record, caller) ? (record.grantId ?? record.id) : undefined;
}
