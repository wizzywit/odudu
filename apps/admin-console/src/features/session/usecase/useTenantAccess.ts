import { useEffect, useRef } from 'react';
import { signedInElsewhere, type Principal } from '#/features/session/service.ts';
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
  const home = ended?.tenant ?? tenant;
  const left = useRef(false);
  useEffect(() => {
    if (principal !== null || left.current) return;
    left.current = true;
    signIn(home);
  });
  if (principal === null) return { kind: 'signing-in', tenant: home, ended: ended !== null };
  if (signedInElsewhere(principal, tenant)) {
    return {
      kind: 'elsewhere',
      principal,
      signIn: () => {
        signIn(tenant);
      },
    };
  }
  return { kind: 'allowed', principal };
}
