import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Sends the window to a page outside the console, a sign-in or an
// end-session, telling the guard first so the unload prompt stays quiet.
export function useLeaveConsole(): (url: string) => void {
  const { leavePage } = useTransport();
  return (url) => {
    useUnsavedGuard.getState().release();
    leavePage(url);
  };
}
