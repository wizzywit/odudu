import { create } from 'zustand';
import type { Toast } from '#/shared/services/toast';

interface ToastQueue {
  toasts: readonly Toast[];
  // The number the next toast's id is made from.
  nextId: number;
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastQueue>()((set, get) => ({
  toasts: [],
  nextId: 1,
  push: (toast) => {
    const id = `toast-${String(get().nextId)}`;
    set((queue) => ({ toasts: [...queue.toasts, { ...toast, id }], nextId: queue.nextId + 1 }));
    return id;
  },
  dismiss: (id) => {
    set((queue) => ({ toasts: queue.toasts.filter((t) => t.id !== id) }));
  },
}));

// What a usecase says of a change: a success waits for the reader, an error
// stays until dismissed.
export function useToast() {
  const push = useToasts((queue) => queue.push);
  return {
    succeeded: (message: string): void => {
      push({ tone: 'success', message });
    },
    failed: (message: string): void => {
      push({ tone: 'error', message });
    },
  };
}
