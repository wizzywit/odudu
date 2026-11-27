import { TASK_EVENT } from '#/entities/assistant/adapter/taskEvent';
import type { AskedTask } from '#/entities/assistant/types/taskRequest';

/** A page puts a task in front of the assistant panel of its tenant, if there is one. */
export function askAssistant(task: AskedTask): void {
  window.dispatchEvent(new CustomEvent(TASK_EVENT, { detail: task }));
}
