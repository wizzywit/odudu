import { useToasts } from '#/shared/repository/useToasts.ts';
import { Toasts } from '#/shared/view/Toasts.tsx';

// The one reader of the toast queue: the view renders what it is given, so it
// stays clear of the store (a view never imports shared/repository).
export function ToastLayer() {
  const toasts = useToasts((queue) => queue.toasts);
  const dismiss = useToasts((queue) => queue.dismiss);
  return <Toasts toasts={toasts} onDismiss={dismiss} />;
}
