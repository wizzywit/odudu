import type { AssistantConversation } from '@odudu/contracts/admin';
import type { UIMessage } from 'ai';

function textPartsOf(parts: readonly Record<string, unknown>[]): UIMessage['parts'] {
  return parts.flatMap((part) =>
    part.type === 'text' && typeof part.text === 'string'
      ? [{ type: 'text' as const, text: part.text }]
      : [],
  );
}

// A stored conversation as the chat client holds its messages. Only text is
// carried over: the server writes parts the panel does not draw, and a part
// whose shape the client has not seen is better absent than half understood.
export function chatMessagesOf(conversation: AssistantConversation): UIMessage[] {
  return conversation.messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: textPartsOf(message.parts),
  }));
}
