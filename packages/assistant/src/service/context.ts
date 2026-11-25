import type { UIMessage } from 'ai';

// The most earlier messages one turn sends. The request is bounded by this
// count, not in bytes: each tool result inside a message is capped upstream
// at 256,000 characters.
export const HISTORY_MESSAGES = 40;

/**
 * The latest messages of a conversation, starting on a person's message so a
 * reply is never sent without the question it answers.
 */
export function boundHistory(messages: readonly UIMessage[]): UIMessage[] {
  const tail = messages.slice(-HISTORY_MESSAGES);
  const firstUser = tail.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : tail.slice(firstUser);
}
