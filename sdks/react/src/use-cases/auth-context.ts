import { createContext, useContext } from 'react';
import { missingProvider } from '#/services/errors';
import type { AuthContextValue } from '#/types';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = AuthContext.Provider;

export function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) throw missingProvider();
  return value;
}
