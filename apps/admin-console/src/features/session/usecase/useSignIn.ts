import { useLocation } from '@tanstack/react-router';
import { loginUrl } from '#/features/session/service.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Sign-in is the tenant's own login page, so it leaves the console; it comes
// back to the page it left from unless told where else.
export function useSignIn(): (tenant: string, returnTo?: string) => void {
  const { leavePage } = useTransport();
  const { publicHref } = useLocation();
  return (tenant, returnTo = publicHref) => {
    const guard = useUnsavedGuard.getState();
    guard.request(() => {
      guard.release();
      leavePage(loginUrl(tenant, returnTo));
    });
  };
}
