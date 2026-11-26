import type { Read } from '#/shared/lib/services/read';
import type { AssistantMode, ChatStatus, HistoryState } from '#/widgets/assistant-panel/types/chat';

// Where the stored conversation is, for a panel opened on one: nothing is read
// for a conversation that has not started.
export function historyOf(read: Pick<Read<unknown>, 'status'>, asked: boolean): HistoryState {
  return asked ? read.status : 'none';
}

// What the stored conversation holds, once it has been read.
export function storedOf<T>(read: Read<T>, asked: boolean): T | undefined {
  return asked && read.status === 'ready' ? read.data : undefined;
}

// The mode of the conversation: its own when it was stored, else Ask. Act is
// not offered from the console until the approval card exists, so neither the
// tenant's default nor a choice can make a new conversation one.
export function modeOf(stored: { mode: AssistantMode } | undefined): AssistantMode {
  return stored?.mode ?? 'ask';
}

// Whether a stored conversation may be shown now: only over a panel with
// nothing live and nothing drawn, never over a turn in progress.
export function mayShowStored(chat: ChatStatus, messageCount: number): boolean {
  return chat === 'ready' && messageCount === 0;
}

// The conversation to read: the one the shell remembers, except when this panel
// made it, which it already holds.
export function readIdOf(conversationId: string | null, createdId: string | null): string | null {
  return conversationId === createdId ? null : conversationId;
}
