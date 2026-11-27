import type { TaskCarry, TaskRequest } from '#/entities/assistant/types/taskRequest';

// A request is for one tenant's panel; another tenant's is not this one's to take.
export function requestFor(request: TaskRequest | null, tenant: string): TaskRequest | null {
  return request?.tenant === tenant ? request : null;
}

// What an earlier panel left is for the tenant it was in.
export function carryFor(carry: TaskCarry | null, tenant: string): TaskCarry | null {
  return carry?.tenant === tenant ? carry : null;
}
