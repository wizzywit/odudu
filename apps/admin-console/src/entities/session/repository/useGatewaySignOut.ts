import { logOut } from '#/entities/session/adapter/logout';
import { signOutDestination } from '#/entities/session/services/loginUrl';
import { sessionGone } from '#/entities/session/services/boot';
import { useDrafts } from '#/shared/lib/repository/useDrafts';
import { useLeaveConsole } from '#/entities/session/repository/useLeaveConsole';
import { useTransport } from '#/shared/api/transport/useTransport';

// Once the session is gone this tab's drafts are dropped and the page left;
// true if it was.
export function useGatewaySignOut(): () => Promise<boolean> {
  const { auth } = useTransport();
  const leave = useLeaveConsole();
  const forgetAll = useDrafts((drafts) => drafts.forgetAll);
  return async () => {
    const result = await logOut(auth);
    if (!sessionGone(result)) return false;
    forgetAll();
    leave(signOutDestination(result));
    return true;
  };
}
