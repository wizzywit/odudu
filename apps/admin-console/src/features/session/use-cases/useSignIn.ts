import { useLocation } from '@tanstack/react-router';
import { loginUrl } from '#/features/session/services';
import { useLeaveConsole } from '#/features/session/repository/useLeaveConsole';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';

// Sign-in is the tenant's own login page, so it leaves the console; it comes
// back to the page it left from unless told where else.
export function useSignIn(): (tenant: string, returnTo?: string) => void {
  const leave = useLeaveConsole();
  const request = useUnsavedGuard((guard) => guard.request);
  const { publicHref } = useLocation();
  return (tenant, returnTo = publicHref) => {
    request(() => {
      leave(loginUrl(tenant, returnTo));
    });
  };
}
