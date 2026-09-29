import { useState } from 'react';
import { useAuthorityQuery } from '#/features/session/repository/useAuthorityQuery.ts';
import { SYSTEM_TENANT, type AdminCapability, type Authority } from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

function useWhoami(tenant: string) {
  const { principal, ended } = useSignedIn();
  return useAuthorityQuery(tenant, principal?.subjectId ?? null, ended === null);
}

export function useAuthority(tenant: string): Authority | undefined {
  return useWhoami(tenant).authority;
}

// For a change to what the principal holds, which whoami has not seen.
export function useRereadAuthority(tenant: string): () => void {
  return useWhoami(tenant).reread;
}

// Whether the tenant in the address exists, as far as whoami can say:
// undefined until it answers. Only a system administrator reaches a tenant
// other than their own, so only their 401 can mean that none has the name.
export function useTenantMissing(tenant: string): boolean | undefined {
  const { principal } = useSignedIn();
  const { refusedUnknown } = useWhoami(tenant);
  if (principal?.tenant !== SYSTEM_TENANT || tenant === SYSTEM_TENANT) {
    return refusedUnknown === undefined ? undefined : false;
  }
  return refusedUnknown;
}

// A 403 names the capability the refused action needed and re-reads whoami,
// since what the console was told the principal holds is now in doubt.
export function useRefusal(tenant: string): {
  readonly refused: AdminCapability | null;
  readonly report: (result: GatewayResult<unknown>, needed: AdminCapability) => boolean;
} {
  const { reread } = useWhoami(tenant);
  const [refused, setRefused] = useState<AdminCapability | null>(null);
  return {
    refused,
    report: (result, needed) => {
      if (result.ok || result.kind !== 'problem' || result.problem.status !== 403) return false;
      setRefused(needed);
      reread();
      return true;
    },
  };
}
