import { useGatewaySignOut } from '#/features/session/repository/useGatewaySignOut.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

export function useSignOut(): () => void {
  const signOut = useGatewaySignOut();
  return () => {
    useUnsavedGuard.getState().request(() => {
      signOut()
        .then((left) => {
          if (!left) {
            useToasts.getState().push({ tone: 'error', message: 'Could not sign out. Try again.' });
          }
        })
        .catch(() => undefined);
    });
  };
}
