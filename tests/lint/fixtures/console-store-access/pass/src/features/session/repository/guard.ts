import { useToasts } from '#/shared/lib/repository/useToasts';

export function askTheGuard(): Promise<boolean> {
  return new Promise((resolve) => {
    useToasts.getState().push('asked');
    resolve(true);
  });
}

export function useSelected() {
  const push = useToasts((queue) => queue.push);
  const toasts = useToasts((queue) => queue.toasts);
  return { push, toasts };
}
