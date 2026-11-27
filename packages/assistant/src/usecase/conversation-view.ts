import { effectiveMode } from '#/service/profiles';
import type { AssistantConversation } from '@odudu/contracts/admin';
import type { UIMessage } from 'ai';
import type { ConversationRecord } from '#/repository/conversations';
import type { MessageRecord } from '#/repository/messages';

/**
 * A stored message as the AI SDK reads it. The parts column holds only what
 * this package wrote from a UIMessage's parts, so the cast restates what the
 * writer guaranteed.
 */
export function toUiMessage(conversationId: string, record: MessageRecord): UIMessage {
  return {
    id: `${conversationId}-${String(record.seq)}`,
    role: record.role === 'assistant' ? 'assistant' : 'user',
    parts: record.parts as UIMessage['parts'],
  };
}

/** The messages a person and the model read: the system message is the server's own. */
export function visibleMessages(
  conversationId: string,
  records: readonly MessageRecord[],
): UIMessage[] {
  return records
    .filter((record) => record.role !== 'system')
    .map((record) => toUiMessage(conversationId, record));
}

export function conversationView(
  record: ConversationRecord,
  messages: readonly UIMessage[],
): AssistantConversation {
  return {
    id: record.id,
    profile: record.profile,
    mode: effectiveMode(record.profile, record.mode),
    title: record.title,
    created_at: record.createdAt.toISOString(),
    last_active_at: record.lastActiveAt.toISOString(),
    messages: messages.flatMap((message) =>
      message.role === 'system'
        ? []
        : [
            {
              id: message.id,
              role: message.role,
              parts: message.parts.map((part) => ({ ...part })),
            },
          ],
    ),
  };
}
