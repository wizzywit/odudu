import { createContext, useContext } from 'react';
import type { Principal } from '#/features/session/service.ts';

export interface SignedIn {
  principal: Principal | null;
  // Whose session ended while the console was open, or null when none did.
  ended: Principal | null;
}

export const SignedInContext = createContext<SignedIn>({ principal: null, ended: null });

export function useSignedIn(): SignedIn {
  return useContext(SignedInContext);
}

export function usePrincipal(): Principal {
  const { principal } = useContext(SignedInContext);
  if (principal === null) throw new Error('usePrincipal is only for pages behind a sign-in');
  return principal;
}
