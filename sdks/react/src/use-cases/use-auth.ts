import { useAuthContext } from '#/use-cases/auth-context';
import type { Auth } from '#/types';

export function useAuth(): Auth {
  const { state, signIn, signOut } = useAuthContext();
  return { status: state.status, signIn, signOut, error: state.error };
}
