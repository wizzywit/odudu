import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import { useTransport } from '#/shared/transport/useTransport';

// Sends the window to a page outside the console, a sign-in or an
// end-session, telling the guard first so the unload prompt stays quiet.
export function useLeaveConsole(): (url: string) => void {
  const { leavePage } = useTransport();
  const release = useUnsavedGuard((guard) => guard.release);
  return (url) => {
    release();
    leavePage(url);
  };
}
