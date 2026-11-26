import type { Read } from '#/shared/lib/services/read';
import type { AssistantMode, HistoryState } from '#/widgets/assistant-panel/types/chat';

// Where the stored conversation is, for a panel opened on one: nothing is read
// for a conversation that has not started.
export function historyOf(read: Pick<Read<unknown>, 'status'>, asked: boolean): HistoryState {
  return asked ? read.status : 'none';
}

// What the stored conversation holds, once it has been read.
export function storedOf<T>(read: Read<T>, asked: boolean): T | undefined {
  return asked && read.status === 'ready' ? read.data : undefined;
}

// The mode the person chose, else the conversation's own, else the tenant's.
export function modeOf(
  choice: AssistantMode | null,
  stored: { mode: AssistantMode } | undefined,
  tenantDefault: AssistantMode | undefined,
): AssistantMode {
  return choice ?? stored?.mode ?? tenantDefault ?? 'ask';
}
