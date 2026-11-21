import { useAuthContext } from '#/use-cases/auth-context';
import type { Claims } from '#/types';

// The ID token's claims (browser mode) or the claims the BFF reports.
export function useUser(): Claims | undefined {
  return useAuthContext().state.claims;
}
