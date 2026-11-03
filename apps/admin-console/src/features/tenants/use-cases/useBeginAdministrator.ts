import { draftOwner, usePrincipal } from '#/entities/session';
import { beginAdministrator, storedCreation } from '#/features/tenants/repository/useCreation';
import { useGo } from '#/shared/repository/useGo';
import { administratorStepHref } from '#/features/tenants/services/draftRoute';
import { resumesAdministrator } from '#/features/tenants/services/creationDraft';

export interface BeginAdministrator {
  start: () => void;
}

// Each tenant keeps its own administrator in progress: one whose subject
// was created is resumed, since a retry would find its username taken and
// leave it without a role; anything less is begun afresh.
export function useBeginAdministrator(
  tenant: string,
  origin: 'imported' | 'existing',
): BeginAdministrator {
  const principal = usePrincipal();
  const owner = draftOwner(principal);
  const go = useGo();
  return {
    start: () => {
      const stored = storedCreation(owner, tenant);
      if (!resumesAdministrator(stored)) {
        beginAdministrator(owner, tenant, origin);
      }
      go(administratorStepHref(tenant));
    },
  };
}
