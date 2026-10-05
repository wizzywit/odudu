import { useGatewaySignOut } from '#/features/session/repository/useGatewaySignOut.ts';
import { SIGN_OUT_FAILED } from '#/features/session/service';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

export function useSignOut(): () => void {
  const signOut = useGatewaySignOut();
  return () => {
    useUnsavedGuard.getState().request(() => {
      signOut()
        .then((left) => {
          if (!left) {
            useToasts.getState().push({ tone: 'error', message: SIGN_OUT_FAILED });
          }
        })
        .catch(() => undefined);
    });
  };
}
