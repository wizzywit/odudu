import { useLeaveConsole } from '#/shared/repository/useLeaveConsole.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

// Reloads the page once the unsaved-changes guard lets it go, asking in the
// console's own dialog rather than the browser's.
export function useReloadConsole(): () => void {
  const leave = useLeaveConsole();
  return () => {
    useUnsavedGuard.getState().request(() => {
      leave(window.location.href);
    });
  };
}
