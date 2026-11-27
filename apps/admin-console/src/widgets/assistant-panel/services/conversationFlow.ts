import {
  CONVERSATION_ARCHIVED_TYPE,
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
// sign-in ended for a reason other than signing out is read-only for good, so
// hiding does not hide that.
export function readOnlyOf(state: {
  // What the person did here to hide or restore it, when they did.
  archivedHere?: boolean | undefined;
  // What the server last said of it, when it has.
  server?: { archived: boolean; continuable: boolean } | undefined;
  // A refusal of the last message, which says the same thing sooner.
  refusedEnd?: RefusedEnd | null | undefined;
}): ReadOnlyReason | null {
  const archived =
    (state.archivedHere ?? state.server?.archived ?? false) || state.refusedEnd === 'archived';
  if (archived) return 'archived';
  const continuable = (state.server?.continuable ?? true) && state.refusedEnd !== 'revoked';
  return continuable ? null : 'ended';
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

export type RefusedEnd = 'revoked' | 'archived';

// A message the server refused because the conversation cannot be carried on is
// told apart by its problem type: its earlier sign-in was ended for another
// reason, or it is hidden. Any other refusal is neither.
export function refusedEndOf(error: unknown): RefusedEnd | null {
  if (!(error instanceof ChatCallError) || error.failure.kind !== 'problem') return null;
  const { type } = error.failure.problem;
  if (type === CONVERSATION_ENDED_TYPE) return 'revoked';
  return type === CONVERSATION_ARCHIVED_TYPE ? 'archived' : null;
}

// The text of the last message when it is the person's and the server refused it
// and took it back; null otherwise.
export function unsentTextOf(
  messages: readonly { role: string; parts: readonly unknown[] }[],
  refused: boolean,
): string | null {
  const last = messages[messages.length - 1];
  if (!refused || last?.role !== 'user') return null;
  const text = last.parts
    .flatMap((part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n');
  return text === '' ? null : text;
}
