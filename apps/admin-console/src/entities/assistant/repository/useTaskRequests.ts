import { create } from 'zustand';
import type { TaskCarry, TaskRequest } from '#/entities/assistant/types/taskRequest';

interface TaskRequests {
  // The tenant whose shell holds the assistant gate; a request is for it or for nobody.
  gate: string | null;
  request: TaskRequest | null;
  nextSeq: number;
  carry: TaskCarry | null;
  attach: (tenant: string) => () => void;
  ask: (request: Omit<TaskRequest, 'seq'>) => void;
  take: () => void;
  hand: (carry: TaskCarry) => void;
}

export const useTaskRequests = create<TaskRequests>()((set) => ({
  gate: null,
  request: null,
  nextSeq: 1,
  carry: null,
  attach: (tenant) => {
    set({ gate: tenant });
    return () => {
      set((state) => ({
        gate: state.gate === tenant ? null : state.gate,
        request: null,
        carry: null,
      }));
    };
  },
  ask: (request) => {
    set((state) =>
      state.gate === request.tenant
        ? { request: { ...request, seq: state.nextSeq }, nextSeq: state.nextSeq + 1 }
        : {},
    );
  },
  take: () => {
    set({ request: null });
  },
  hand: (carry) => {
    set({ carry });
  },
}));
