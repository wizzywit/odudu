import { useDispatchTask } from '#/entities/assistant/repository/useDispatchTask';
import type { AskedTask } from '#/entities/assistant/types/taskRequest';

/** The call a page makes to put a task in front of the assistant panel. */
export function useAskAssistant(): (task: AskedTask) => void {
  return useDispatchTask();
}
