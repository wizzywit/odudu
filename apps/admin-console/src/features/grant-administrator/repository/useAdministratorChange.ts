import {
  grantHoldings,
  type Refused,
} from '#/features/grant-administrator/repository/administratorRoles';
import { countKey, holdersKey, listKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { SYSTEM_TENANT } from '#/shared/lib/services/principal';
import { useWrite } from '#/shared/lib/repository/useWrite';

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
