import { logOut } from '#/features/session/adapter/logout.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useLeaveConsole } from '#/shared/repository/useLeaveConsole.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// After the signed-in subject deleted itself: its sessions went with it, so
// the gateway's session is ended and the console starts again signed out,
// without following an end-session for a subject that no longer exists.
export function useEndOwnSession(): () => Promise<void> {
  const { auth } = useTransport();
  const leave = useLeaveConsole();
  return async () => {
    await logOut(auth).catch(() => undefined);
    useDrafts.getState().forgetAll();
    leave('/console/');
  };
}
