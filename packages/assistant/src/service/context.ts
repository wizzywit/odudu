import type { UIMessage } from 'ai';

// The most earlier messages one turn sends to the model.
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
