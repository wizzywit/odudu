import type { ReactNode } from 'react';
import { useAuth } from '#/use-cases/use-auth';

export function SignedIn({ children }: { children: ReactNode }) {
  return useAuth().status === 'signedIn' ? children : null;
}
