import { askAssistant } from '#/entities/assistant/adapter/askAssistant';
import type { AskedTask } from '#/entities/assistant/types/taskRequest';

/** The call a page makes to put a task in front of the assistant panel. */
export function useDispatchTask(): (task: AskedTask) => void {
  return askAssistant;
}
