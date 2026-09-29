import { useLocation } from '@tanstack/react-router';
import { loginUrl } from '#/features/session/service.ts';
import { useLeaveConsole } from '#/shared/repository/useLeaveConsole.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

// Sign-in is the tenant's own login page, so it leaves the console; it comes
// back to the page it left from unless told where else.
export function useSignIn(): (tenant: string, returnTo?: string) => void {
  const leave = useLeaveConsole();
  const { publicHref } = useLocation();
  return (tenant, returnTo = publicHref) => {
    useUnsavedGuard.getState().request(() => {
      leave(loginUrl(tenant, returnTo));
    });
  };
}
