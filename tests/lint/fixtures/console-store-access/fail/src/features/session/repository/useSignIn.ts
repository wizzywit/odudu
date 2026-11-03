import { useToasts } from '#/shared/lib/repository/useToasts';

export function useSignIn() {
  return async () => {
    await Promise.resolve();
    useToasts.getState().push('signed in');
  };
}

export const useSignOut = () => {
  const queue = useToasts.getState();
  return () => {
    queue.push('signed out');
  };
};
