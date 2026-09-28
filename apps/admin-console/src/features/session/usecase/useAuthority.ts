import { useState } from 'react';
import { useAuthorityQuery } from '#/features/session/repository/useAuthorityQuery.ts';
import type { AdminCapability, Authority } from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

function useWhoami(tenant: string) {
  const { principal } = useSignedIn();
  return useAuthorityQuery(tenant, principal?.subjectId ?? null);
}

export function useAuthority(tenant: string): Authority | undefined {
  return useWhoami(tenant).authority;
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
