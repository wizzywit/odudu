import { useGatewaySessionEnd } from '#/features/session/repository/useGatewaySessionEnd';
import { CONSOLE_ROOT } from '#/shared/services/address';
import { useDrafts } from '#/shared/repository/useDrafts';
import { useLeaveConsole } from '#/features/session/repository/useLeaveConsole';

// After the signed-in subject deleted itself: its sessions went with it, so
// the gateway's session is ended and the console starts again signed out,
// without following an end-session for a subject that no longer exists.
export function useEndOwnSession(): () => Promise<void> {
  const endSession = useGatewaySessionEnd();
  const leave = useLeaveConsole();
  const forgetAll = useDrafts((drafts) => drafts.forgetAll);
  return async () => {
    await endSession();
    forgetAll();
    leave(CONSOLE_ROOT);
  };
}
