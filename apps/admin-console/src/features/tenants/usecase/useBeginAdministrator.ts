import { useState } from 'react';
import { usePrincipal } from '#/features/session/index.ts';
import { beginAdministrator, storedCreation } from '#/features/tenants/repository/useCreation.ts';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { NEW_TENANT_HREF } from '#/features/tenants/service.ts';

export interface Unfinished {
  readonly tenant: string;
  readonly username: string;
}

export interface BeginAdministrator {
  readonly start: () => void;
  // A subject created elsewhere but not finished, which starting would drop.
  readonly replacing: Unfinished | null;
  readonly replace: () => void;
  readonly keep: () => void;
}

// One creation is kept per tab. A half-made administrator of this tenant is
// resumed; of another, it is only dropped once the person says so, since a
// retry would find its username taken and leave it without a role.
export function useBeginAdministrator(
  tenant: string,
  origin: 'imported' | 'existing',
): BeginAdministrator {
  const principal = usePrincipal();
  const owner = `${principal.tenant}/${principal.subjectId}`;
  const go = useGo();
  const [replacing, setReplacing] = useState<Unfinished | null>(null);
  const begin = (): void => {
    setReplacing(null);
    beginAdministrator(owner, tenant, origin);
    go(NEW_TENANT_HREF);
  };
  return {
    start: () => {
      const stored = storedCreation(owner);
      if (stored?.step !== 'administrator' || stored.subjectId === null) {
        begin();
      } else if (stored.tenant === tenant) {
        go(NEW_TENANT_HREF);
      } else {
        setReplacing({ tenant: stored.tenant, username: stored.username });
      }
    },
    replacing,
    replace: begin,
    keep: () => {
      setReplacing(null);
    },
  };
}
