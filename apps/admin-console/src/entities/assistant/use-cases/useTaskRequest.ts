import { useTaskRequests } from '#/entities/assistant/repository/useTaskRequests';
import { requestFor } from '#/entities/assistant/services/taskRequest';
import type { TaskRequest } from '#/entities/assistant/types/taskRequest';

/** What a page calls to put a task in front of the assistant panel. */
export function useAskAssistant(): (request: Omit<TaskRequest, 'seq'>) => void {
  return useTaskRequests((state) => state.ask);
}

/** The task a page asked for in this tenant, and the call that says it was taken up. */
export function useTaskRequest(tenant: string): {
  request: TaskRequest | null;
  take: () => void;
} {
  const request = useTaskRequests((state) => state.request);
  const take = useTaskRequests((state) => state.take);
  return { request: requestFor(request, tenant), take };
}
