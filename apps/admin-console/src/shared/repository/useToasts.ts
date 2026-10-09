import { create } from 'zustand';
import type { Toast } from '#/shared/service/toast.ts';

interface ToastQueue {
  toasts: readonly Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

let issued = 0;

export const useToasts = create<ToastQueue>()((set) => ({
  toasts: [],
  push: (toast) => {
    issued += 1;
    const id = `toast-${String(issued)}`;
    set((queue) => ({ toasts: [...queue.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => {
    set((queue) => ({ toasts: queue.toasts.filter((t) => t.id !== id) }));
  },
}));
