import type { ReactNode } from 'react';
import { useAuth } from '#/use-cases/use-auth';

// Renders nothing while `useAuth().error` is set, so an app that signs the
// person in whenever this renders cannot loop through an outage or a refused
// sign-in; it shows the error itself.
export function SignedOut({ children }: { children: ReactNode }) {
  const { status, error } = useAuth();
  return status === 'signedOut' && error === undefined ? children : null;
}
