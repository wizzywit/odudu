import { useEffect, useRef } from 'react';
import { SYSTEM_TENANT, type Principal } from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';

export type TenantAccess =
  | { readonly kind: 'allowed'; readonly principal: Principal }
  | { readonly kind: 'signing-in'; readonly ended: boolean };

// A tenant in the URL goes straight to its sign-in unless its own
// administrator, or a system administrator entering it, is signed in.
export function useTenantAccess(tenant: string): TenantAccess {
  const { principal, ended } = useSignedIn();
  const signIn = useSignIn();
  const allowed =
    principal !== null && (principal.tenant === tenant || principal.tenant === SYSTEM_TENANT);
  const left = useRef(false);
  useEffect(() => {
    if (allowed || left.current) return;
    left.current = true;
    signIn(tenant);
  });
  return allowed ? { kind: 'allowed', principal } : { kind: 'signing-in', ended };
}
