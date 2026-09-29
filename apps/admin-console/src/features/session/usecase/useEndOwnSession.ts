import { useGatewaySessionEnd } from '#/features/session/repository/useGatewaySessionEnd.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useLeaveConsole } from '#/shared/repository/useLeaveConsole.ts';

// After the signed-in subject deleted itself: its sessions went with it, so
// the gateway's session is ended and the console starts again signed out,
// without following an end-session for a subject that no longer exists.
export function useEndOwnSession(): () => Promise<void> {
  const endSession = useGatewaySessionEnd();
  const leave = useLeaveConsole();
  return async () => {
    await endSession();
    useDrafts.getState().forgetAll();
    leave('/console/');
  };
}
