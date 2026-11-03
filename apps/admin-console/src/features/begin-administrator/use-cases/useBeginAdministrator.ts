import { administratorStepHref, beginOrResumeAdministrator } from '#/entities/creation-draft';
import { draftOwner, usePrincipal } from '#/entities/session';
import { useGo } from '#/shared/lib/repository/useGo';

export interface BeginAdministrator {
  start: () => void;
}

// Each tenant keeps its own administrator in progress; the draft decides
// whether the stored one is resumed or begun afresh.
export function useBeginAdministrator(
  tenant: string,
  origin: 'imported' | 'existing',
): BeginAdministrator {
  const owner = draftOwner(usePrincipal());
  const go = useGo();
  return {
    start: () => {
      beginOrResumeAdministrator(owner, tenant, origin);
      go(administratorStepHref(tenant));
    },
  };
}
