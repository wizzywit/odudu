import { logOut } from '#/features/session/adapter/logout.ts';
import { sessionGone } from '#/features/session/service.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useLeaveConsole } from '#/shared/repository/useLeaveConsole.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Once the session is gone this tab's drafts are dropped and the page left;
// true if it was.
export function useGatewaySignOut(): () => Promise<boolean> {
  const { auth } = useTransport();
  const leave = useLeaveConsole();
  return async () => {
    const result = await logOut(auth);
    if (!sessionGone(result)) return false;
    useDrafts.getState().forgetAll();
    leave(result.ok ? result.redirect : '/console/');
    return true;
  };
}
