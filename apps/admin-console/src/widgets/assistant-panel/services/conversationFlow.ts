import {
  CONVERSATION_ENDED_TYPE,
  ChatCallError,
} from '#/widgets/assistant-panel/services/chatCallError';
import type { ChatStatus } from '#/widgets/assistant-panel/types/chat';
import type { ReadOnlyReason } from '#/widgets/assistant-panel/types/conversations';

export type SwitchOutcome = 'stay' | 'open' | 'ask-to-stop';

// What a pick in the list does. The conversation already open is simply
// returned to; while an answer runs the switch waits for the person to say
// whether to stop it, since leaving would otherwise end it unannounced.
export function switchOutcome(
  running: boolean,
  current: string | null,
  target: string | null,
): SwitchOutcome {
  if (target !== null && target === current) return 'stay';
  return running ? 'ask-to-stop' : 'open';
}

// A conversation that is hidden is read-only until it is restored. One whose
// sign-in has ended is read-only for good, so hiding does not hide that.
export function readOnlyOf(state: {
  archived: boolean;
  continuable: boolean;
}): ReadOnlyReason | null {
  if (state.archived) return 'archived';
  return state.continuable ? null : 'ended';
}

interface ChatSnapshot<M> {
  chat: ChatStatus;
  messages: readonly M[];
  error: unknown;
  expectsEnd: boolean;
}

// What the panel draws once the server has refused the last message because
// the sign-in ended: the chat is settled, not failed, and the message the
// server did not take is not shown as sent.
export function unlessEnded<M>(ended: boolean, snapshot: ChatSnapshot<M>): ChatSnapshot<M> {
  if (!ended) return snapshot;
  return {
    chat: 'ready',
    messages: snapshot.messages.slice(0, -1),
    error: undefined,
    expectsEnd: false,
  };
}

// A message to a conversation whose sign-in has ended is refused as its own
// problem type, apart from a turn already running.
export function isConversationEnded(error: unknown): boolean {
  return (
    error instanceof ChatCallError &&
    error.failure.kind === 'problem' &&
    error.failure.problem.type === CONVERSATION_ENDED_TYPE
  );
}
