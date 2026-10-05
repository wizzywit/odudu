import { useMutation, useQueryClient } from '@tanstack/react-query';
import { grantHoldings, type Refused } from '#/shared/repository/administratorRoles.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface AdministratorGrant {
  busy: boolean;
  grant: (subjectId: string, holdings: readonly string[]) => Promise<Refused | null>;
}

// Either way the holders are read again, since a refusal can mean the list
// was already out of date.
export function useAdministratorGrant(): AdministratorGrant {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const grant = useMutation({
    mutationFn: ({ subjectId, holdings }: { subjectId: string; holdings: readonly string[] }) =>
      grantHoldings(gateway, SYSTEM_TENANT, subjectId, holdings),
    onSettled: () => {
      for (const kind of ['list', 'count', 'holders']) {
        client.invalidateQueries({ queryKey: [kind, SYSTEM_TENANT] }).catch(() => undefined);
      }
    },
  });
  return {
    busy: grant.isPending,
    grant: (subjectId, holdings) => grant.mutateAsync({ subjectId, holdings }),
  };
}
