import { usePrincipal } from '#/features/session/index.ts';
import { beginAdministrator, storedCreation } from '#/features/tenants/repository/useCreation.ts';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { administratorStepHref } from '#/features/tenants/service.ts';

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
  const owner = `${principal.tenant}/${principal.subjectId}`;
  const go = useGo();
  return {
    start: () => {
      const stored = storedCreation(owner, tenant);
      if (stored?.step !== 'administrator' || stored.subjectId === null) {
        beginAdministrator(owner, tenant, origin);
      }
      go(administratorStepHref(tenant));
    },
  };
}
