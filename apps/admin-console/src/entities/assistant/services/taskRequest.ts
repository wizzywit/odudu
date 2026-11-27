import type { AskedTask, TaskRequest } from '#/entities/assistant/types/taskRequest';

// The task a page's event asked for, when it is for this tenant's panel.
export function askedFor(detail: AskedTask, tenant: string): AskedTask | null {
  return detail.tenant === tenant ? detail : null;
}

// The task the panel was last asked for in this tenant, or none.
export function lastFor(task: TaskRequest | null, tenant: string): TaskRequest | null {
  return task?.tenant === tenant ? task : null;
}
