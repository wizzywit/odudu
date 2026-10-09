import { useEffect, useRef } from 'react';
import { signInHome, tenantEntry, type Principal } from '#/features/session/service';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';

export type TenantAccess =
  | { kind: 'allowed'; principal: Principal }
  | { kind: 'signing-in'; tenant: string; ended: boolean }
  | {
      kind: 'elsewhere';
      principal: Principal;
      signIn: () => void;
    };

// A tenant in the URL goes straight to its sign-in when nobody is signed
// in; its own administrator, or a system administrator entering it, is let
// in; another tenant's administrator is asked first. A session that ended
// here signs in again where it was issued, which for a system administrator
// is `system`, and comes back to this page.
export function useTenantAccess(tenant: string): TenantAccess {
  const { principal, ended } = useSignedIn();
  const signIn = useSignIn();
  const home = signInHome(ended, tenant);
  const left = useRef(false);
  useEffect(() => {
    if (principal !== null || left.current) return;
    left.current = true;
    signIn(home);
  });
  const entry = tenantEntry(principal, ended, tenant);
  if (entry.kind === 'elsewhere') {
    return {
      ...entry,
      signIn: () => {
        signIn(tenant);
      },
    };
  }
  return entry;
}
