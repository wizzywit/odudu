import { create } from 'zustand';
import type { TaskRequest } from '#/entities/assistant/types/taskRequest';

interface TaskRequests {
  request: TaskRequest | null;
  nextSeq: number;
  ask: (request: Omit<TaskRequest, 'seq'>) => void;
  take: () => void;
}

export const useTaskRequests = create<TaskRequests>()((set) => ({
  request: null,
  nextSeq: 1,
  ask: (request) => {
    set((state) => ({
      request: { ...request, seq: state.nextSeq },
      nextSeq: state.nextSeq + 1,
    }));
  },
  take: () => {
    set({ request: null });
  },
}));
