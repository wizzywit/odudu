import { useState } from 'react';
import { useAuthorityQuery } from '#/features/session/repository/useAuthorityQuery.ts';
import { tenantMissing, type AdminCapability, type Authority } from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { isRefused } from '#/shared/service/failure.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

function useWhoami(tenant: string) {
  const { principal, ended } = useSignedIn();
  return useAuthorityQuery(tenant, principal?.subjectId ?? null, ended === null);
}

export function useAuthority(tenant: string): Authority | undefined {
  return useWhoami(tenant).authority;
}

// Whether whoami has answered for the tenant, well or not: until then the
// console cannot say what the principal may reach.
export function useAuthorityAnswered(tenant: string): boolean {
  return useWhoami(tenant).answered;
}

// For a change to what the principal holds, which whoami has not seen.
export function useRereadAuthority(tenant: string): () => void {
  return useWhoami(tenant).reread;
}

// Whether the tenant in the address exists, as far as whoami can say.
export function useTenantMissing(tenant: string): boolean | undefined {
  const { principal } = useSignedIn();
  const { refusedUnknown } = useWhoami(tenant);
  return tenantMissing(principal, tenant, refusedUnknown);
}

// A 403 names the capability the refused action needed and re-reads whoami,
// since what the console was told the principal holds is now in doubt.
export function useRefusal(tenant: string): {
  refused: AdminCapability | null;
  report: (result: GatewayResult<unknown>, needed: AdminCapability) => boolean;
} {
  const { reread } = useWhoami(tenant);
  const [refused, setRefused] = useState<AdminCapability | null>(null);
  return {
    refused,
    report: (result, needed) => {
      if (!isRefused(result)) return false;
      setRefused(needed);
      reread();
      return true;
    },
  };
}
