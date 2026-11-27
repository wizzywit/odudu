import type { AskedTask } from '#/entities/assistant/types/taskRequest';

// The task a page's event asked for, when it is for this tenant's panel.
export function askedFor(detail: AskedTask, tenant: string): AskedTask | null {
  return detail.tenant === tenant ? detail : null;
}
