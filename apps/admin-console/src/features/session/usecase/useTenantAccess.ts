import { useEffect, useRef } from 'react';
import { signedInElsewhere, type Principal } from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';

export type TenantAccess =
  | { readonly kind: 'allowed'; readonly principal: Principal }
  | { readonly kind: 'signing-in'; readonly ended: boolean }
  | {
      readonly kind: 'elsewhere';
      readonly principal: Principal;
      readonly signIn: () => void;
    };

// A tenant in the URL goes straight to its sign-in when nobody is signed
// in; its own administrator, or a system administrator entering it, is let
// in; another tenant's administrator is asked first.
export function useTenantAccess(tenant: string): TenantAccess {
  const { principal, ended } = useSignedIn();
  const signIn = useSignIn();
  const left = useRef(false);
  useEffect(() => {
    if (principal !== null || left.current) return;
    left.current = true;
    signIn(tenant);
  });
  if (principal === null) return { kind: 'signing-in', ended };
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
