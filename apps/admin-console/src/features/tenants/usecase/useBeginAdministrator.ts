import { useState } from 'react';
import { usePrincipal } from '#/features/session/index.ts';
import { beginAdministrator, storedCreation } from '#/features/tenants/repository/useCreation.ts';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { administratorStepHref } from '#/features/tenants/service.ts';

export interface Unfinished {
  readonly tenant: string;
  readonly username: string;
  // Whether tenant-admin landed, leaving only the one-time password.
  readonly granted: boolean;
}

export interface BeginAdministrator {
  readonly start: () => void;
  // A subject created elsewhere but not finished, which starting would drop.
  readonly replacing: Unfinished | null;
  readonly replace: () => void;
  readonly keep: () => void;
}

// One creation is kept per tab for each flow. A half-made administrator of this tenant is
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
  const destination = administratorStepHref(tenant);
  const begin = (): void => {
    setReplacing(null);
    beginAdministrator(owner, tenant, origin);
    go(destination);
  };
  return {
    start: () => {
      const stored = storedCreation(owner, tenant);
      if (stored?.step !== 'administrator' || stored.subjectId === null) {
        begin();
      } else if (stored.tenant === tenant) {
        go(destination);
      } else {
        setReplacing({
          tenant: stored.tenant,
          username: stored.username,
          granted: stored.granted,
        });
      }
    },
    replacing,
    replace: begin,
    keep: () => {
      setReplacing(null);
    },
  };
}
