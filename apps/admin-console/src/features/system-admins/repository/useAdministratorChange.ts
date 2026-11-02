import { grantHoldings, type Refused } from '#/shared/repository/administratorRoles';
import { countKey, holdersKey, listKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { useWrite } from '#/shared/repository/useWrite';

export interface AdministratorGrant {
  busy: boolean;
  grant: (subjectId: string, holdings: readonly string[]) => Promise<Refused | null>;
}

// Either way the holders are read again, since a refusal can mean the list
// was already out of date.
export function useAdministratorGrant(): AdministratorGrant {
  const { invalidate } = useInvalidate();
  const grant = useWrite({
    send: (gateway, { subjectId, holdings }: { subjectId: string; holdings: readonly string[] }) =>
      grantHoldings(gateway, SYSTEM_TENANT, subjectId, holdings),
    onSettled: () => {
      invalidate(listKey(SYSTEM_TENANT), countKey(SYSTEM_TENANT), holdersKey(SYSTEM_TENANT));
    },
  });
  return {
    busy: grant.busy,
    grant: (subjectId, holdings) => grant.run({ subjectId, holdings }),
  };
}
