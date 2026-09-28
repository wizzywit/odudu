import { logOut } from '#/features/session/adapter/logout.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useLeaveConsole } from '#/shared/repository/useLeaveConsole.ts';
import { isSessionEnded } from '#/shared/service/sessionEnded.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// The session is gone once the gateway has answered for it: signed out, or
// already ended, or signed out with a redirect the console will not follow.
// Only then are this tab's drafts dropped and the page left; true if it was.
export function useGatewaySignOut(): () => Promise<boolean> {
  const { auth } = useTransport();
  const leave = useLeaveConsole();
  return async () => {
    const result = await logOut(auth);
    const gone =
      result.ok ||
      result.kind === 'schema' ||
      (result.kind === 'problem' && isSessionEnded(result.problem));
    if (!gone) return false;
    useDrafts.getState().forgetAll();
    leave(result.ok ? result.redirect : '/console/');
    return true;
  };
}
