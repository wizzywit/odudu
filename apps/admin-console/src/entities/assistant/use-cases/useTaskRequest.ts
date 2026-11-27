import { useTaskRequests } from '#/entities/assistant/repository/useTaskRequests';
import { useEffect } from 'react';
import { carryFor, requestFor } from '#/entities/assistant/services/taskRequest';
import type { TaskCarry, TaskRequest } from '#/entities/assistant/types/taskRequest';

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

/** Says a gate for this tenant is mounted, so a page's request has a panel to reach. */
export function useGateAttached(tenant: string): void {
  const attach = useTaskRequests((state) => state.attach);
  useEffect(() => attach(tenant), [attach, tenant]);
}

/** What the panel a task replaced left behind, and the call to leave it. */
export function useTaskCarry(tenant: string): {
  carried: TaskCarry | null;
  hand: (carry: TaskCarry) => void;
} {
  const carry = useTaskRequests((state) => state.carry);
  const hand = useTaskRequests((state) => state.hand);
  return { carried: carryFor(carry, tenant), hand };
}
