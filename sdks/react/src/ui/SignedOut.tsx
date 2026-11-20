import type { ReactNode } from 'react';
import { useAuth } from '#/use-cases/use-auth';

export function SignedOut({ children }: { children: ReactNode }) {
  return useAuth().status === 'signedOut' ? children : null;
}
