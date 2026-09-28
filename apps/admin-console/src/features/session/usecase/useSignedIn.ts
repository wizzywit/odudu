import { createContext, useContext } from 'react';
import type { Principal } from '#/features/session/service.ts';

export interface SignedIn {
  readonly principal: Principal | null;
  // The session ended while the console was open, rather than never began.
  readonly ended: boolean;
}

export const SignedInContext = createContext<SignedIn>({ principal: null, ended: false });

export function useSignedIn(): SignedIn {
  return useContext(SignedInContext);
}

export function usePrincipal(): Principal {
  const { principal } = useContext(SignedInContext);
  if (principal === null) throw new Error('usePrincipal is only for pages behind a sign-in');
  return principal;
}
