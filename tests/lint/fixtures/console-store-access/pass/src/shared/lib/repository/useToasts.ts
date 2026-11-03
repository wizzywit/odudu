import { create } from 'zustand';

interface Queue {
  toasts: string[];
  push: (message: string) => void;
  reset: () => void;
}

export const useToasts = create<Queue>()((set) => ({
  toasts: [],
  push: (message) => {
    set((queue) => ({ toasts: [...queue.toasts, message] }));
  },
  reset: () => {
    set({ toasts: [] });
  },
}));
