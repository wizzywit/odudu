import type { AskedTask } from '#/entities/assistant/types/taskRequest';

export const TASK_EVENT = 'odudu:assistant-task';

// Calls `onTask` with each event's detail, until the returned function is called.
export function listenForTask(onTask: (detail: AskedTask) => void): () => void {
  const handle = (event: Event): void => {
    if (event instanceof CustomEvent) onTask(event.detail as AskedTask);
  };
  window.addEventListener(TASK_EVENT, handle);
  return () => {
    window.removeEventListener(TASK_EVENT, handle);
  };
}
