import { useLeaveConsole } from '#/entities/session/repository/useLeaveConsole';
import { pageHref } from '#/shared/lib/platform/location';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';

// Reloads the page once the unsaved-changes guard lets it go, asking in the
// console's own dialog rather than the browser's.
export function useReloadConsole(): () => void {
  const leave = useLeaveConsole();
  const request = useUnsavedGuard((guard) => guard.request);
  return () => {
    request(() => {
      leave(pageHref());
    });
  };
}
