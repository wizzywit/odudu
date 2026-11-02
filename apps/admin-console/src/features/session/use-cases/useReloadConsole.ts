import { useLeaveConsole } from '#/features/session/repository/useLeaveConsole';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';

// Reloads the page once the unsaved-changes guard lets it go, asking in the
// console's own dialog rather than the browser's.
export function useReloadConsole(): () => void {
  const leave = useLeaveConsole();
  const request = useUnsavedGuard((guard) => guard.request);
  return () => {
    request(() => {
      leave(window.location.href);
    });
  };
}
