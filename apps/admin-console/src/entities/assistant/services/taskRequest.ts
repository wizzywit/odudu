import type { TaskRequest } from '#/entities/assistant/types/taskRequest';

// The task the panel was last asked for in this tenant, or none.
export function lastFor(task: TaskRequest | null, tenant: string): TaskRequest | null {
  return task?.tenant === tenant ? task : null;
}
