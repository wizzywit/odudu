import { useEffect } from 'react';
import { listenForTask } from '#/entities/assistant/adapter/taskEvent';
import type { AskedTask } from '#/entities/assistant/types/taskRequest';

/** Calls `onTask` for each task a page asks for, while the caller is drawn. */
export function useTaskListener(onTask: (task: AskedTask) => void): void {
  useEffect(() => listenForTask(onTask), [onTask]);
}
