import { useGatewaySignOut } from '#/entities/session/repository/useGatewaySignOut';
import { SIGN_OUT_FAILED } from '#/entities/session/services/loginError';
import { useToast } from '#/shared/repository/useToasts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';

export function useSignOut(): () => void {
  const signOut = useGatewaySignOut();
  const toast = useToast();
  const request = useUnsavedGuard((guard) => guard.request);
  return () => {
    request(() => {
      signOut()
        .then((left) => {
          if (!left) toast.failed(SIGN_OUT_FAILED);
        })
        .catch(() => undefined);
    });
  };
}
