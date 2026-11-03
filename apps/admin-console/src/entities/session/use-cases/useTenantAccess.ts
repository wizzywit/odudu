import { useEffect, useRef } from 'react';
import { type Principal } from '#/entities/session/types/principal';
import { signInHome, tenantEntry } from '#/entities/session/services/entry';
import {
  signedInElsewhereWords,
  signingInWords,
  type SignedInElsewhereWords,
  type SigningInWords,
} from '#/entities/session/services/sessionStatusText';
import { useSignedIn } from '#/entities/session/use-cases/useSignedIn';
import { useSignIn } from '#/entities/session/use-cases/useSignIn';

export type TenantAccess =
  | { kind: 'allowed'; principal: Principal }
  | { kind: 'signing-in'; ended: boolean; words: SigningInWords }
  | {
      kind: 'elsewhere';
      principal: Principal;
      words: SignedInElsewhereWords;
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
      words: signedInElsewhereWords(entry.principal.tenant, tenant),
      signIn: () => {
        signIn(tenant);
      },
    };
  }
  if (entry.kind === 'signing-in') {
    return {
      kind: 'signing-in',
      ended: entry.ended,
      words: signingInWords(entry.tenant, entry.ended),
    };
  }
  return entry;
}
